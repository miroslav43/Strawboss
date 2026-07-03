package com.smsgateway.app

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Single source of truth for persisted configuration and gateway identity.
 *
 * Plain private [SharedPreferences] (not EncryptedSharedPreferences): the phone is
 * a dedicated single-purpose gateway and the device token is a per-device value, so
 * we avoid the flaky Keystore/Tink path that EncryptedSharedPreferences hits on cheap
 * hardware. The prefs file is app-private (MODE_PRIVATE).
 */
object Prefs {
    const val FILE = "sms_gateway"

    // Config
    const val KEY_API_KEY = "apiKey" // legacy local-server key
    const val KEY_SERVER_URL = "serverUrl" // pull-mode backend base URL
    const val KEY_POLL_INTERVAL_SEC = "pollIntervalSec"
    const val KEY_LOCAL_SERVER_ENABLED = "localServerEnabled"

    // Gateway identity + delivery-report queue
    const val KEY_DEVICE_UUID = "deviceUuid"
    const val KEY_DEVICE_TOKEN = "deviceToken"
    const val KEY_PENDING_REPORTS = "pendingReports" // JSON array queued for next check-in

    const val DEFAULT_SERVER_URL = "https://nortiauno.com"
    const val DEFAULT_POLL_INTERVAL_SEC = 20

    // No credential is shipped: the (optional, off-by-default) local server refuses
    // to send while its key is blank, so the operator must set one to enable it.
    const val DEFAULT_API_KEY = ""

    fun of(context: Context): SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun serverUrl(p: SharedPreferences): String =
        (p.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL)
            .trim()
            .trimEnd('/')

    fun pollIntervalSec(p: SharedPreferences): Int =
        p.getInt(KEY_POLL_INTERVAL_SEC, DEFAULT_POLL_INTERVAL_SEC).coerceIn(5, 3600)

    fun localServerEnabled(p: SharedPreferences): Boolean =
        p.getBoolean(KEY_LOCAL_SERVER_ENABLED, false)

    fun apiKey(p: SharedPreferences): String =
        p.getString(KEY_API_KEY, "") ?: ""

    /** Stable per-install device id; generated and persisted on first access. */
    fun deviceUuid(p: SharedPreferences): String {
        p.getString(KEY_DEVICE_UUID, null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        p.edit().putString(KEY_DEVICE_UUID, fresh).apply()
        return fresh
    }

    fun deviceToken(p: SharedPreferences): String? = p.getString(KEY_DEVICE_TOKEN, null)

    fun setDeviceToken(p: SharedPreferences, token: String) {
        p.edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }
}
