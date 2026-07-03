package com.smsgateway.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * **Pull-mode** transport — the reason this app no longer needs Tailscale.
 *
 * Instead of waiting for the server to reach into the phone (push), the phone dials
 * OUT to `POST <serverUrl>/api/v1/fleet/checkin` on a timer. That endpoint:
 *   - registers the device on first contact and returns a `deviceTokenIssued`
 *     (we persist it and send it as `deviceToken` on every later call);
 *   - returns `pendingSms: [{id, to, body}]` for devices flagged `is_sms_gateway`
 *     (the claim is atomic server-side: pending → sent);
 *   - accepts `smsReports: [{id, status, error?}]` to move each row sent → delivered|failed.
 *
 * Because the phone initiates the connection, it works from cellular or any Wi-Fi
 * with no inbound reachability and no VPN.
 *
 * Delivery reports are sent on the *next* check-in (the current one already claimed
 * the messages), so the `/messages` monitor confirms delivery within one poll
 * interval. Reports are persisted to prefs so an app/OS kill between "SMS sent" and
 * "report delivered" cannot silently lose them; a row left in `sent` is recoverable
 * via the admin Retry button.
 */
object CheckinClient {

    private data class Report(val id: String, val status: String, val error: String?)
    private data class PendingSms(val id: String, val to: String, val body: String)
    private data class CheckinResponse(val deviceTokenIssued: String?, val pendingSms: List<PendingSms>)

    /** One check-in cycle. Safe to call repeatedly from the service poll loop. */
    fun poll(context: Context, prefs: SharedPreferences, log: (String) -> Unit) {
        // 1) Flush any reports queued from the previous cycle.
        val queued = loadQueuedReports(prefs)
        val resp = postCheckin(prefs, queued, log) ?: return // network/HTTP error → keep queue, retry next tick

        // Check-in succeeded → the reports we just sent have been applied server-side.
        if (queued.isNotEmpty()) saveQueuedReports(prefs, emptyList())

        // 2) Persist a freshly issued device token (first registration only).
        resp.deviceTokenIssued?.let {
            Prefs.setDeviceToken(prefs, it)
            log("✓ Înregistrat la server (token primit)")
        }

        if (resp.pendingSms.isEmpty()) return

        // 3) Send each claimed SMS and build its report for the next cycle.
        val fresh = ArrayList<Report>(resp.pendingSms.size)
        for (sms in resp.pendingSms) {
            if (!SmsSender.isValidPhone(sms.to)) {
                fresh += Report(sms.id, "failed", "Invalid phone number")
                log("✗ SMS ${sms.to}: număr invalid")
                continue
            }
            val (ok, err) = SmsSender.sendSms(context, sms.to, sms.body)
            fresh += Report(sms.id, if (ok) "sent" else "failed", if (ok) null else err)
            log(if (ok) "✓ SMS → ${sms.to}" else "✗ SMS ${sms.to}: $err")
        }
        // Persist immediately; they go out on the next check-in.
        saveQueuedReports(prefs, fresh)
    }

    private fun postCheckin(
        prefs: SharedPreferences,
        reports: List<Report>,
        log: (String) -> Unit,
    ): CheckinResponse? {
        val endpoint = "${Prefs.serverUrl(prefs)}/api/v1/fleet/checkin"
        val payload = JSONObject().apply {
            put("deviceUuid", Prefs.deviceUuid(prefs))
            Prefs.deviceToken(prefs)?.let { put("deviceToken", it) }
            put("appVersion", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("isDeviceOwner", false)
            put("activeTrip", false)
            if (reports.isNotEmpty()) {
                val arr = JSONArray()
                for (r in reports) {
                    arr.put(
                        JSONObject().apply {
                            put("id", r.id)
                            put("status", r.status)
                            r.error?.let { put("error", it.take(500)) }
                        },
                    )
                }
                put("smsReports", arr)
            }
        }.toString()

        val conn = (URL(endpoint).openConnection() as HttpURLConnection)
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""

            if (code !in 200..299) {
                log("✗ check-in HTTP $code: ${text.take(200)}")
                return null
            }
            parseResponse(text)
        } catch (e: Exception) {
            log("✗ check-in error: ${e.message}")
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun parseResponse(text: String): CheckinResponse {
        val json = JSONObject(text)
        val tokenIssued = json.optString("deviceTokenIssued", "").ifBlank { null }
        val pending = ArrayList<PendingSms>()
        json.optJSONArray("pendingSms")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                pending += PendingSms(o.getString("id"), o.getString("to"), o.getString("body"))
            }
        }
        return CheckinResponse(tokenIssued, pending)
    }

    private fun loadQueuedReports(prefs: SharedPreferences): List<Report> {
        val raw = prefs.getString(Prefs.KEY_PENDING_REPORTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Report(o.getString("id"), o.getString("status"), o.optString("error", "").ifBlank { null })
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun saveQueuedReports(prefs: SharedPreferences, reports: List<Report>) {
        val arr = JSONArray()
        for (r in reports) {
            arr.put(
                JSONObject().apply {
                    put("id", r.id)
                    put("status", r.status)
                    r.error?.let { put("error", it) }
                },
            )
        }
        prefs.edit().putString(Prefs.KEY_PENDING_REPORTS, arr.toString()).apply()
    }
}
