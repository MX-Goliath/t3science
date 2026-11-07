package expo.modules.t3agentnotifications

import android.app.Notification
import androidx.core.app.NotificationCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 36])
class DirectNotificationPresentationTest {
  @Test
  fun prioritizesAttentionAcrossEnvironmentsAndReturnsToTheConnectionState() {
    val work = DirectActivity("/threads/a/work", "Build feature", "running")
    val input = DirectActivity("/threads/b/question", "Choose a target", "waiting_for_input")
    val approval =
      DirectActivity("/threads/a/approval", "Approve deployment", "waiting_for_approval")
    val cases = listOf(
      emptyList<DirectActivity>() to "Online",
      listOf(work) to "Working",
      listOf(work, work.copy(path = "/threads/b/work")) to "2 work",
      listOf(work, input) to "Answer",
      listOf(work, input, approval) to "Approve"
    )
    for ((activities, chip) in cases) {
      val presentation = directConnectionPresentation(2, 2, activities)
      assertEquals(chip, presentation.chip)
      assertEquals("2 of 2 environments connected", presentation.connections)
    }
    assertEquals(
      approval.path,
      directConnectionPresentation(2, 2, listOf(work, input, approval)).path
    )
    assertEquals("Offline", directConnectionPresentation(0, 2, emptyList()).chip)
    assertEquals("No host", directConnectionPresentation(0, 0, emptyList()).chip)
    assertEquals("9+ work", directConnectionPresentation(1, 1, List(12) { work }).chip)
  }

  @Test
  fun buildsAnUncolorizedOngoingLiveUpdateWithARegularNotificationFallback() {
    val context = RuntimeEnvironment.getApplication()
    val presentation = directConnectionPresentation(
      1,
      1,
      listOf(
        DirectActivity("/threads/a/work", "Build feature", "running")
      )
    )
    val notification = directConnectionNotification(context, presentation).build()
    assertTrue(NotificationCompat.isRequestPromotedOngoing(notification))
    assertEquals(
      "Working",
      notification.extras.getString(NotificationCompat.EXTRA_SHORT_CRITICAL_TEXT)
    )
    assertFalse(notification.extras.getBoolean(NotificationCompat.EXTRA_COLORIZED))
    assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertTrue(notification.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
    assertFalse(notification.extras.getBoolean(Notification.EXTRA_SHOW_WHEN))
    assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
    assertEquals(
      "Build feature",
      notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    )
    assertEquals(
      "Working · 1 of 1 environments connected",
      notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString()
    )
  }
}
