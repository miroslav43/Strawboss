package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fires on the watchdog alarm. If the operator has the gateway ON but the service
 * isn't running (OEM kill / app-swipe / Doze), restart it. Always re-arms the alarm
 * so the safety-net keeps ticking (setAndAllowWhileIdle is one-shot).
 */
class WatchdogReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_TICK = "com.smsgateway.app.WATCHDOG_TICK"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = Prefs.of(context)
        if (Prefs.serviceEnabled(prefs) && !SmsGatewayService.isRunning) {
            try {
                context.startForegroundService(
                    Intent(context, SmsGatewayService::class.java)
                        .setAction(SmsGatewayService.ACTION_START),
                )
            } catch (_: Exception) {
            }
        }
        // Re-arm regardless: a one-shot alarm must reschedule itself to keep watching.
        AlarmScheduler.schedule(context)
    }
}
