package expo.modules.t3agentnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class DirectNotificationService : Service() {
  private val thread = HandlerThread("t3-direct-notifications")
  private lateinit var worker: Handler
  private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS).pingInterval(30, TimeUnit.SECONDS)
    .followRedirects(false).followSslRedirects(false).build()
  private val connections = mutableMapOf<String, Connection>()
  private var configuration = ""
  private var scheme = "t3science"

  @Volatile private var destroyed = false

  override fun onBind(intent: Intent?) = null

  override fun onCreate() {
    super.onCreate()
    thread.start()
    worker = Handler(thread.looper)
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java).createNotificationChannels(
        listOf(
          NotificationChannel(CHANNEL, "Background connection", NotificationManager.IMPORTANCE_LOW),
          NotificationChannel(ALERTS, "Direct agent alerts", NotificationManager.IMPORTANCE_HIGH)
        )
      )
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val saved = runCatching { DirectNotificationStore(this).read() }.getOrNull()
    if (saved == null || !NotificationManagerCompat.from(this).areNotificationsEnabled()) {
      DirectNotificationStore(this).clear()
      status = JSONObject().put("enabled", false).put("connected", 0).put("total", 0).toString()
      stopSelf()
      return START_NOT_STICKY
    }
    val notification = connectionNotification("Connecting to your environments")
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(ID, notification)
    }
    worker.post {
      if (saved != configuration) {
        configuration = saved
        connections.values.forEach { it.close() }
        connections.clear()
        val config = JSONObject(saved)
        scheme = config.getString("scheme")
        val entries = config.getJSONArray("connections")
        for (i in 0 until entries.length()) {
          val entry = entries.getJSONObject(i)
          connections[entry.getString("environmentId")] = Connection(entry)
        }
        monitoredEnvironments = connections.keys.toSet()
        connections.values.forEach { it.connect() }
      }
      publishStatus()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    destroyed = true
    monitoredEnvironments = emptySet()
    worker.post {
      connections.values.forEach { it.close() }
      connections.clear()
      client.dispatcher.executorService.shutdown()
      client.connectionPool.evictAll()
      thread.quitSafely()
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun connectionNotification(text: String) = NotificationCompat.Builder(this, CHANNEL)
    .setSmallIcon(R.drawable.agent_activity_mark)
    .setContentTitle("T3 Science background notifications")
    .setContentText(text).setOngoing(true).setSilent(true)
    .setContentIntent(openApp("/", ID))
    .build()

  private fun publishStatus() {
    if (destroyed) return
    val connected = connections.values.count { it.connected }
    val errors = JSONArray(
      connections.values.filter { it.error != null }.map {
        JSONObject().put("environmentId", it.config.getString("environmentId"))
          .put("label", it.config.getString("label")).put("message", it.error)
      }
    )
    status = JSONObject().put("enabled", true).put("connected", connected)
      .put("total", connections.size).put("errors", errors).toString()
    getSystemService(NotificationManager::class.java).notify(
      ID,
      connectionNotification(
        if (connections.isEmpty()) {
          "No direct connections enabled"
        } else {
          "$connected of ${connections.size} environments connected"
        }
      )
    )
  }

  private fun openApp(path: String, id: Int): PendingIntent? {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    intent.action = Intent.ACTION_VIEW
    intent.data = Uri.parse("$scheme:/$path")
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      this,
      id,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun alert(environmentId: String, id: String, state: DirectThreadState) {
    if (destroyed) return
    val path = "/threads/${Uri.encode(environmentId)}/${Uri.encode(id)}"
    if (androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(
        androidx.lifecycle.Lifecycle.State.RESUMED
      ) &&
      AgentNotifications.isThreadOnScreen(path)
    ) {
      return
    }
    val title = when (state.phase) {
      "completed" -> "Agent finished"
      "failed" -> "Agent failed"
      "waiting_for_input" -> "Waiting for your answer"
      else -> "Approval needed"
    }
    val tag = "t3-direct:$environmentId:$id"
    val notification = NotificationCompat.Builder(this, ALERTS)
      .setSmallIcon(R.drawable.agent_activity_mark).setContentTitle(title)
      .setContentText(state.title).setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setDefaults(android.app.Notification.DEFAULT_ALL)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setContentIntent(openApp(path, tag.hashCode())).build()
    if (NotificationManagerCompat.from(this).areNotificationsEnabled()) {
      getSystemService(NotificationManager::class.java).notify(tag, 0, notification)
    }
  }

  private inner class Connection(val config: JSONObject) {
    val state = DirectNotificationState()
    var connected = false
    var error: String? = null
    private var stopped = false
    private var generation = 0
    private var attempt = 0
    private var socket: WebSocket? = null
    private var call: Call? = null
    private val retry = Runnable { connect() }

    fun close() {
      stopped = true
      generation++
      worker.removeCallbacks(retry)
      call?.cancel()
      socket?.cancel()
    }

    fun connect(legacy: Boolean = false) {
      if (stopped || destroyed) return
      val current = ++generation
      val base = config.getString("httpBaseUrl").trimEnd('/')
      val path = if (legacy) "/api/auth/websocket-ticket" else "/api/auth/websocket-ticket/rpc"
      val request = Request.Builder().url(base + path)
        .header("Authorization", "Bearer ${config.getString("bearerToken")}")
        .header("x-t3-orchestration-protocol", config.getString("protocol"))
        .post("".toRequestBody("application/json".toMediaType())).build()
      call = client.newCall(request).also {
        it.enqueue(object : Callback {
          override fun onFailure(
            call: Call,
            e: IOException
          ) {
            worker.post { failed(current, "Connection unavailable") }
          }
          override fun onResponse(call: Call, response: Response) {
            response.use {
              val code = response.code
              val ticket = if (response.isSuccessful) {
                runCatching {
                  JSONObject(response.body?.string().orEmpty()).getString("ticket")
                }.getOrNull()
              } else {
                null
              }
              worker.post {
                if (stopped || current != generation) return@post
                if (code == 404 && !legacy) {
                  connect(true)
                  return@post
                }
                if (ticket == null) {
                  failed(
                    current,
                    if (code in
                      setOf(401, 403)
                    ) {
                      "Reconnect this environment in Settings"
                    } else {
                      "Could not authorize connection (HTTP $code)"
                    },
                    code in setOf(401, 403)
                  )
                  return@post
                }
                val url = Uri.parse(config.getString("wsBaseUrl")).buildUpon()
                if (Uri.parse(config.getString("wsBaseUrl")).path.isNullOrEmpty() ||
                  Uri.parse(config.getString("wsBaseUrl")).path == "/"
                ) {
                  url.path("/ws")
                }
                url.appendQueryParameter("wsTicket", ticket)
                  .appendQueryParameter("orchestrationProtocol", config.getString("protocol"))
                  .appendQueryParameter("clientSurface", "mobile")
                  .appendQueryParameter("connectionMethod", "direct")
                socket =
                  client.newWebSocket(
                    Request.Builder().url(url.build().toString()).build(),
                    listener(current)
                  )
              }
            }
          }
        })
      }
    }

    private fun listener(current: Int) = object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        webSocket.send(
          JSONObject().put("_tag", "Request").put("id", "1")
            .put("tag", config.getString("subscribeMethod")).put("headers", JSONArray())
            .put(
              "payload",
              JSONObject().put("omitIdleSubagents", true).put("omitOlderSettled", true)
            ).toString()
        )
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        worker.post {
          if (stopped || current != generation) return@post
          try {
            // Effect's JSON serialization batches multiple RPC envelopes in one frame.
            val messages = if (text.trimStart().startsWith(
                "["
              )
            ) {
              JSONArray(text)
            } else {
              JSONArray().put(JSONObject(text))
            }
            for (i in 0 until messages.length()) {
              val message = messages.getJSONObject(i)
              when (message.optString("_tag")) {
                "Ping" -> webSocket.send("{\"_tag\":\"Pong\"}")
                "Chunk" -> {
                  val values = message.getJSONArray("values")
                  for (j in 0 until values.length()) {
                    val item = values.getJSONObject(j)
                    state.accept(item).forEach {
                      alert(config.getString("environmentId"), it.first, it.second)
                    }
                  }
                  webSocket.send("{\"_tag\":\"Ack\",\"requestId\":\"1\"}")
                  if (!connected) {
                    connected = true
                    attempt = 0
                    error = null
                    publishStatus()
                  }
                }
                "Exit", "Defect" -> failed(current, "Event stream ended; reconnecting")
              }
            }
          } catch (
            _: Exception
          ) {
            failed(current, "Unsupported event stream; update the app and server")
          }
        }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        worker.post { failed(current, "Connection lost; reconnecting") }
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        worker.post { failed(current, "Connection closed; reconnecting") }
      }
      override fun onClosing(
        webSocket: WebSocket,
        code: Int,
        reason: String
      ) {
        webSocket.close(code, null)
      }
    }

    private fun failed(current: Int, message: String, blocked: Boolean = false) {
      if (stopped || current != generation) return
      generation++
      connected = false
      error = message
      socket?.cancel()
      socket = null
      publishStatus()
      if (!blocked) {
        worker.postDelayed(
          retry,
          (1000L shl attempt++.coerceAtMost(6)).coerceAtMost(60_000L)
        )
      }
    }
  }

  companion object {
    private const val CHANNEL = "direct-connection"
    private const val ALERTS = "direct-agent-alerts"
    private const val ID = 7440

    @Volatile private var monitoredEnvironments: Set<String> = emptySet()
    fun handles(path: String?): Boolean = path != null && Uri.parse(path).pathSegments.let {
      it.firstOrNull() == "threads" && it.getOrNull(1) in monitoredEnvironments
    }

    @Volatile var status: String = "{\"enabled\":false,\"connected\":0,\"total\":0}"
  }
}
