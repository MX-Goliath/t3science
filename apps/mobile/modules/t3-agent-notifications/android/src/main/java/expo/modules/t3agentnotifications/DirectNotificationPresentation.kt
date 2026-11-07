package expo.modules.t3agentnotifications

import android.content.Context
import androidx.core.app.NotificationCompat

internal const val DIRECT_CONNECTION_CHANNEL = "direct-connection"

internal data class DirectActivity(val path: String, val title: String, val phase: String)

internal data class DirectConnectionPresentation(
  val chip: String,
  val title: String,
  val text: String,
  val connections: String,
  val path: String = "/"
)

internal fun directConnectionPresentation(
  connected: Int,
  total: Int,
  activities: List<DirectActivity>
): DirectConnectionPresentation {
  val hero = activities.minByOrNull(::activityPriority)
  val connections = "$connected of $total environments connected"
  val chip = when {
    hero?.phase == "waiting_for_approval" -> "Approve"
    hero?.phase == "waiting_for_input" -> "Answer"
    activities.size > 1 -> "${if (activities.size > 9) "9+" else activities.size} work"
    hero != null -> "Working"
    total == 0 -> "No host"
    connected == 0 -> "Offline"
    else -> "Online"
  }
  val title = hero?.title?.ifBlank { "Agent activity" } ?: connectionTitle(connected, total)
  return DirectConnectionPresentation(
    chip,
    title,
    if (hero == null) connections else "$chip · $connections",
    connections,
    hero?.path ?: "/"
  )
}

private fun activityPriority(activity: DirectActivity): Int = when (activity.phase) {
  "waiting_for_approval" -> 0
  "waiting_for_input" -> 1
  else -> 2
}

private fun connectionTitle(connected: Int, total: Int): String = when {
  total == 0 -> "No direct connections enabled"
  connected == 0 -> "Reconnecting to your environments"
  else -> "Connected to your environments"
}

internal fun directConnectionNotification(
  context: Context,
  presentation: DirectConnectionPresentation
): NotificationCompat.Builder = NotificationCompat.Builder(context, DIRECT_CONNECTION_CHANNEL)
  .setSmallIcon(R.drawable.agent_activity_mark)
  .setContentTitle(presentation.title)
  .setContentText(presentation.text)
  .setStyle(NotificationCompat.BigTextStyle().bigText(presentation.text))
  .setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
  .setColorized(false).setShowWhen(false)
  .setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
  .setRequestPromotedOngoing(true)
  .setShortCriticalText(presentation.chip)
