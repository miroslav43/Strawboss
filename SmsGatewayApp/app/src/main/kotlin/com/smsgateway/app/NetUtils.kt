package com.smsgateway.app

import android.content.Context
import android.net.wifi.WifiManager
import android.text.format.Formatter
import java.net.NetworkInterface

/**
 * Best-effort local IP lookup for display in the UI. Only relevant to the legacy
 * LAN push server; pull mode does not need it. Recovered from the original APK.
 */
object NetUtils {

    fun getLocalIp(context: Context): String? {
        // Try the Wi-Fi address first (fast path on the common case).
        try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            val ipInt = wm.connectionInfo?.ipAddress ?: 0
            if (ipInt != 0) {
                @Suppress("DEPRECATION")
                return Formatter.formatIpAddress(ipInt)
            }
        } catch (_: Exception) {
        }

        // Fall back to the first non-loopback IPv4 on any up interface.
        return try {
            NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.asSequence() }
                .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(":") == false }
                ?.hostAddress
        } catch (_: Exception) {
            null
        }
    }
}
