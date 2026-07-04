package com.smsgateway.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Best-effort watchdog alarm — NO exact-alarm permission needed.
 *
 * Every ~15 min it wakes [WatchdogReceiver], which restarts the service if it died.
 * `setAndAllowWhileIdle` fires even in Doze (throttled to a ~9 min minimum) and is a
 * one-shot alarm, so the receiver re-arms it on every fire. The foreground service +
 * `START_STICKY` are the PRIMARY keep-alive; this alarm only re-asserts after an OEM
 * kill / app-swipe where those fail.
 */
object AlarmScheduler {
    const val INTERVAL_MS = 15L * 60 * 1000
    private const val REQ = 4711

    private fun pending(context: Context): PendingIntent {
        val i = Intent(context, WatchdogReceiver::class.java).setAction(WatchdogReceiver.ACTION_TICK)
        return PendingIntent.getBroadcast(
            context,
            REQ,
            i,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    fun schedule(context: Context) {
        try {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + INTERVAL_MS,
                pending(context),
            )
        } catch (_: Exception) {
        }
    }

    fun cancel(context: Context) {
        try {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pending(context))
        } catch (_: Exception) {
        }
    }
}
