package expo.modules.t3agentnotifications

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")

    AsyncFunction("configureDirectNotifications") { configuration: String? ->
      val context = requireNotNull(appContext.reactContext)
      val store = DirectNotificationStore(context)
      if (configuration == null) {
        store.clear()
        DirectNotificationService.status = "{\"enabled\":false,\"connected\":0,\"total\":0}"
        context.stopService(Intent(context, DirectNotificationService::class.java))
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        manager.activeNotifications.filter { it.tag?.startsWith("t3-direct:") == true }
          .forEach { manager.cancel(it.tag, it.id) }
      } else {
        check(NotificationManagerCompat.from(context).areNotificationsEnabled()) {
          "Enable notifications in Android Settings first."
        }
        val config = JSONObject(configuration)
        require(config.getString("scheme").matches(Regex("[a-zA-Z][a-zA-Z0-9+.-]*")))
        val entries = config.getJSONArray("connections")
        for (i in 0 until entries.length()) {
          val entry = entries.getJSONObject(i)
          require(
            android.net.Uri.parse(entry.getString("httpBaseUrl")).scheme in setOf("https", "http")
          )
          require(android.net.Uri.parse(entry.getString("wsBaseUrl")).scheme in setOf("wss", "ws"))
        }
        store.write(configuration)
        ContextCompat.startForegroundService(
          context,
          Intent(context, DirectNotificationService::class.java)
        )
      }
    }

    AsyncFunction("getDirectNotificationStatus") { DirectNotificationService.status }

    Function("openBatterySettings") {
      val context = requireNotNull(appContext.reactContext)
      context.startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }

    Function("showShowcaseActivity") { scheme: String, data: Map<String, String> ->
      appContext.reactContext?.let { AgentNotifications.showcase(it, scheme, data) }
    }

    Function("setThreadOnScreen") { path: String? ->
      AgentNotifications.setThreadOnScreen(path)
    }

    Function("openLiveUpdateSettings") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < 36) {
        false
      } else {
        try {
          context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
