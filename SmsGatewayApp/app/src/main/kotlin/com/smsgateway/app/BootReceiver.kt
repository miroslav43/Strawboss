package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Auto-starts the gateway after a reboot or an app update, but ONLY if the operator
 * had it ON ([Prefs.serviceEnabled]).
 *
 * - `BOOT_COMPLETED` fires only after the FIRST unlock on credential-encrypted storage,
 *   so a rebooted-but-never-unlocked phone stays offline until unlocked once.
 * - `MY_PACKAGE_REPLACED` (our own OTA/app update) has no unlock restriction.
 *
 * Starting a foreground service from these broadcasts is on the Android 12+ background-
 * start allowlist for BOOT_COMPLETED, and works for a battery-opt-exempt app otherwise;
 * the watchdog alarm (re-armed here) covers any case where the direct start is refused.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
            -> {
                if (!Prefs.serviceEnabled(Prefs.of(context))) return
                try {
                    context.startForegroundService(
                        Intent(context, SmsGatewayService::class.java)
                            .setAction(SmsGatewayService.ACTION_START),
                    )
                } catch (_: Exception) {
                }
                AlarmScheduler.schedule(context)
            }
        }
    }
}
