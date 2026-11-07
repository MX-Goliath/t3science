package expo.modules.t3agentnotifications

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DirectNotificationStateTest {
  private fun thread(id: String = "thread", status: String = "running") = JSONObject()
    .put("id", id).put("title", "Review changes").put("status", status)
    .put("latestRunId", "run-1").put("archivedAt", JSONObject.NULL)

  private fun snapshot(vararg threads: JSONObject) = JSONObject().put("kind", "snapshot")
    .put("snapshot", JSONObject().put("threads", JSONArray(threads.toList())))

  private fun update(thread: JSONObject, location: String = "active") = JSONObject()
    .put("kind", "thread.updated").put("location", location).put("thread", thread)

  @Test
  fun baselinesHistoryAndAlertsOnlyOnNewWorkOrRequests() {
    val state = DirectNotificationState()
    assertTrue(state.accept(snapshot(thread(status = "completed"))).isEmpty())
    assertTrue(state.accept(update(thread(status = "completed"))).isEmpty())
    assertTrue(
      state.accept(
        snapshot().put("resolvedRepositoryIdentityRoots", JSONArray().put("/repo"))
      ).isEmpty()
    )
    assertTrue(state.accept(update(thread())).isEmpty())
    assertEquals(
      "completed",
      state.accept(update(thread(status = "completed"))).single().second.phase
    )
    assertTrue(state.accept(update(thread(status = "completed").put("title", "Renamed"))).isEmpty())
    val pending = thread().put(
      "pendingRuntimeRequest",
      JSONObject().put("id", "question-1").put("kind", "user_input")
    )
    assertEquals("waiting_for_input", state.accept(update(pending)).single().second.phase)
    assertTrue(state.accept(update(pending)).isEmpty())
    pending.getJSONObject("pendingRuntimeRequest").put("id", "question-2")
    assertEquals(1, state.accept(update(pending)).size)
    pending.getJSONObject("pendingRuntimeRequest").put("kind", "approval")
    assertEquals("waiting_for_approval", state.accept(update(pending)).single().second.phase)
    pending.getJSONObject("pendingRuntimeRequest").put("kind", "auth_refresh")
    assertTrue(state.accept(update(pending)).isEmpty())
  }

  @Test
  fun reconnectReconcilesKnownThreadsWithoutReplayingHistory() {
    val state = DirectNotificationState()
    state.accept(snapshot(thread("a"), thread("b")))
    val alerts = state.accept(
      snapshot(thread("a", "completed"), thread("b", "failed"), thread("old", "completed"))
    )
    assertEquals(listOf("a", "b"), alerts.map { it.first })
    assertTrue(state.accept(snapshot(thread("a", "completed"), thread("b", "failed"))).isEmpty())
    state.accept(JSONObject().put("kind", "thread.removed").put("threadId", "a"))
    assertTrue(state.accept(snapshot(thread("a", "completed"))).isEmpty())
  }

  @Test
  fun ignoresHiddenArchivedStoppedAndSettledWork() {
    val state = DirectNotificationState()
    state.accept(snapshot())
    for (hidden in listOf(
      thread(status = "completed").put("archivedAt", "2026-11-07"),
      thread(status = "completed").put("latestRunStopRequested", true),
      thread(status = "completed").put("settledOverride", "settled"),
      thread(
        status = "failed"
      ).put("lineage", JSONObject().put("relationshipToParent", "subagent")),
      thread(status = "failed").put("lineage", JSONObject().put("sideChat", true))
    )) {
      assertTrue(state.accept(update(hidden)).isEmpty())
    }
    assertTrue(state.accept(update(thread(status = "failed"), "archive")).isEmpty())
  }

  @Test
  fun completionWaitsForBackgroundWorkAndUsesTheEffectiveRunStatus() {
    for (task in listOf(
      JSONObject().put("kind", "subagent"),
      JSONObject().put("kind", "background_task"),
      JSONObject().put("kind", "command").put("awaited", true)
    )) {
      val state = DirectNotificationState()
      state.accept(snapshot(thread()))
      val completed = thread(
        status = "completed"
      ).put("pendingBackgroundTasks", JSONArray().put(task))
      assertTrue(state.accept(update(completed)).isEmpty())
      completed.put("pendingBackgroundTasks", JSONArray())
      assertEquals(1, state.accept(update(completed)).size)
    }
    val state = DirectNotificationState()
    state.accept(snapshot(thread()))
    assertTrue(
      state.accept(
        update(thread(status = "completed").put("activityRunStatus", "running"))
      ).isEmpty()
    )
    assertEquals(
      1,
      state.accept(
        update(
          thread(status = "completed").put(
            "pendingBackgroundTasks",
            JSONArray()
              .put(JSONObject().put("kind", "monitor").put("awaited", false))
          )
        )
      ).size
    )
  }
}
