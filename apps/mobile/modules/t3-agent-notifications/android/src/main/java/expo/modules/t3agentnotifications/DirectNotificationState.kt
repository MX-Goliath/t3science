package expo.modules.t3agentnotifications

import org.json.JSONObject

internal data class DirectThreadState(val phase: String?, val title: String, val event: String)

internal class DirectNotificationState {
  private val threads = mutableMapOf<String, DirectThreadState>()
  private var synchronized = false

  fun accept(item: JSONObject): List<Pair<String, DirectThreadState>> = when (
    item.optString(
      "kind"
    )
  ) {
    "snapshot" -> snapshot(item)
    "thread.removed" -> {
      threads.remove(item.getString("threadId"))
      emptyList()
    }
    "thread.updated" -> {
      val thread = item.getJSONObject("thread")
      val id = thread.getString("id")
      val next = project(thread)
      val previous = threads.put(id, next)
      if (synchronized && item.optString("location") != "archive" && changed(previous, next)) {
        listOf(id to next)
      } else {
        emptyList()
      }
    }
    else -> emptyList()
  }

  private fun snapshot(item: JSONObject): List<Pair<String, DirectThreadState>> {
    if (item.has("resolvedRepositoryIdentityRoots")) return emptyList()
    val previous = threads.toMap()
    threads.clear()
    val alerts = mutableListOf<Pair<String, DirectThreadState>>()
    val snapshot = item.getJSONObject("snapshot").getJSONArray("threads")
    for (i in 0 until snapshot.length()) {
      val thread = snapshot.getJSONObject(i)
      val id = thread.getString("id")
      val next = project(thread)
      threads[id] = next
      if (synchronized && previous.containsKey(id) &&
        changed(previous[id], next)
      ) {
        alerts.add(id to next)
      }
    }
    synchronized = true
    return alerts
  }

  private fun changed(previous: DirectThreadState?, next: DirectThreadState): Boolean =
    next.phase in ALERT_PHASES && (next.phase != previous?.phase || next.event != previous?.event)

  private fun holdsCompletion(thread: JSONObject): Boolean {
    val tasks = thread.optJSONArray("pendingBackgroundTasks") ?: return false
    return (0 until tasks.length()).any {
      val task = tasks.getJSONObject(it)
      task.optBoolean("awaited") || task.optString("kind") in setOf("subagent", "background_task")
    }
  }

  private fun phase(thread: JSONObject, background: Boolean): String? {
    val request = thread.optJSONObject("pendingRuntimeRequest")
    if (request != null && request.optString("kind") != "auth_refresh") {
      return if (request.optString("kind") ==
        "user_input"
      ) {
        "waiting_for_input"
      } else {
        "waiting_for_approval"
      }
    }
    val status = thread.optString("activityRunStatus").takeUnless { it.isEmpty() || it == "null" }
      ?: thread.optString("status")
    return when (status) {
      "preparing", "starting", "running", "waiting" -> "running"
      "completed" -> if (background) "running" else "completed"
      "failed" -> "failed"
      else -> null
    }
  }

  private fun hidden(thread: JSONObject): Boolean {
    val lineage = thread.optJSONObject("lineage")
    return lineage?.optString("relationshipToParent") == "subagent" ||
      lineage?.optBoolean("sideChat") == true || !thread.isNull("archivedAt")
  }

  private fun terminalSuppressed(thread: JSONObject, phase: String?, background: Boolean): Boolean {
    val settled = thread.optString("settledOverride") == "settled" && !background
    return when (phase) {
      "completed" -> settled || thread.optBoolean("latestRunStopRequested")
      "failed" -> settled
      else -> false
    }
  }

  private fun project(thread: JSONObject): DirectThreadState {
    val background = holdsCompletion(thread)
    val phase = phase(thread, background)
    val visiblePhase = phase.takeUnless {
      hidden(thread) ||
        terminalSuppressed(thread, phase, background)
    }
    // Request identities distinguish consecutive prompts without alerting on title or token updates.
    val event = thread.optJSONObject("pendingRuntimeRequest")?.optString("id").orEmpty().ifEmpty {
      thread.optString("latestRunId").takeUnless { it == "null" }.orEmpty()
    }
    return DirectThreadState(visiblePhase, thread.optString("title").take(200), event)
  }

  companion object {
    val ALERT_PHASES = setOf("completed", "failed", "waiting_for_approval", "waiting_for_input")
  }
}
