package expo.modules.t3agentnotifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class DirectNotificationBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    runCatching {
      if (DirectNotificationStore(context).read() != null) {
        ContextCompat.startForegroundService(
          context,
          Intent(context, DirectNotificationService::class.java)
        )
      }
    }
  }
}
