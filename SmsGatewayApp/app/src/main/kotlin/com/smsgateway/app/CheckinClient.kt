package com.smsgateway.app

import android.content.Context
import android.content.SharedPreferences
import android.os.BatteryManager
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * **Pull-mode** transport + remote-debug client — the reason this app needs no
 * Tailscale.
 *
 * The phone dials OUT to `POST <serverUrl>/api/v1/fleet/checkin` on a timer. Each
 * check-in: registers on first contact (stores `deviceTokenIssued`), reports SMS
 * delivery + remote-command results queued from the previous cycle, then processes
 * the response — pending SMS to send and one-shot debug commands.
 *
 * Because the phone is **not** a Device Owner, only the no-privilege commands are
 * implemented (`report_state`, `fetch_logs`); `reboot`/`reinstall_apk` are answered
 * with `failure` so the server marks them failed and stops re-delivering.
 */
object CheckinClient {

    private data class SmsReport(val id: String, val status: String, val error: String?)
    private data class PendingSms(val id: String, val to: String, val body: String)
    private data class RemoteCommand(val id: String, val type: String)
    private data class CmdReport(val commandId: String, val status: String, val resultJson: String?, val error: String?)
    private data class CheckinResponse(
        val deviceTokenIssued: String?,
        val pendingSms: List<PendingSms>,
        val pendingCommands: List<RemoteCommand>,
    )

    /** One check-in cycle. Safe to call repeatedly from the service poll loop. */
    fun poll(context: Context, prefs: SharedPreferences, log: (String) -> Unit) {
        val smsReports = loadSmsReports(prefs)
        val cmdReports = loadCmdReports(prefs)

        val resp = postCheckin(context, prefs, smsReports, cmdReports, log) ?: return // keep queues, retry

        // Check-in succeeded → everything we sent has been applied server-side.
        if (smsReports.isNotEmpty()) saveSmsReports(prefs, emptyList())
        if (cmdReports.isNotEmpty()) saveCmdReports(prefs, emptyList())

        resp.deviceTokenIssued?.let {
            Prefs.setDeviceToken(prefs, it)
            log("✓ Înregistrat la server (token primit)")
        }

        // 1) Send each claimed SMS; queue its report for the next cycle.
        if (resp.pendingSms.isNotEmpty()) {
            val fresh = ArrayList<SmsReport>(resp.pendingSms.size)
            for (sms in resp.pendingSms) {
                if (!SmsSender.isValidPhone(sms.to)) {
                    fresh += SmsReport(sms.id, "failed", "Invalid phone number")
                    Prefs.incSmsFailed(prefs)
                    log("✗ SMS ${sms.to}: număr invalid")
                    continue
                }
                val (ok, err) = SmsSender.sendSms(context, sms.to, sms.body)
                fresh += SmsReport(sms.id, if (ok) "sent" else "failed", if (ok) null else err)
                if (ok) Prefs.incSmsSent(prefs) else {
                    Prefs.incSmsFailed(prefs)
                    Prefs.setLastError(prefs, "SMS ${sms.to}: $err")
                }
                log(if (ok) "✓ SMS → ${sms.to}" else "✗ SMS ${sms.to}: $err")
            }
            saveSmsReports(prefs, fresh)
        }

        // 2) Execute remote-debug commands; queue their results for the next cycle.
        if (resp.pendingCommands.isNotEmpty()) {
            val executed = loadExecutedIds(prefs)
            val fresh = ArrayList<CmdReport>(resp.pendingCommands.size)
            for (cmd in resp.pendingCommands) {
                if (executed.contains(cmd.id)) {
                    // Already ran — re-ack so the server stops re-delivering.
                    fresh += CmdReport(cmd.id, "success", null, null)
                    continue
                }
                addExecutedId(prefs, cmd.id)
                fresh += handleCommand(context, prefs, cmd, log)
            }
            saveCmdReports(prefs, fresh)
        }
    }

    // ── Command handlers ──────────────────────────────────────────────────────

    private fun handleCommand(
        context: Context,
        prefs: SharedPreferences,
        cmd: RemoteCommand,
        log: (String) -> Unit,
    ): CmdReport = when (cmd.type) {
        "report_state" -> {
            log("⚙ report_state")
            CmdReport(cmd.id, "success", buildStateJson(context, prefs).toString(), null)
        }
        "fetch_logs" -> {
            log("⚙ fetch_logs")
            val result = JSONObject().apply {
                put("lines", JSONArray(LogBuffer.tail(200)))
            }
            CmdReport(cmd.id, "success", result.toString(), null)
        }
        else -> {
            log("⚙ ${cmd.type}: neacceptat (nu e device owner)")
            CmdReport(cmd.id, "failure", null, "unsupported (not device owner)")
        }
    }

    private fun buildStateJson(context: Context, prefs: SharedPreferences): JSONObject {
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val batteryPct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            ?.takeIf { it in 0..100 }
        val uptimeMs = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()

        return JSONObject().apply {
            put("reportAt", iso.format(Date()))
            put("appVersion", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("buildProfile", if (BuildConfig.DEBUG) "debug" else "release")
            put("appUptimeMs", uptimeMs)
            put("online", true) // we just completed a network round-trip
            put("batteryPct", batteryPct ?: JSONObject.NULL)
            put("isCharging", bm?.isCharging ?: JSONObject.NULL)
            put("model", Build.MODEL)
            put("manufacturer", Build.MANUFACTURER)
            put("osVersion", Build.VERSION.RELEASE)
            // Gateway-specific health
            put("serviceRunning", SmsGatewayService.isRunning)
            put("deviceRegistered", Prefs.deviceToken(prefs) != null)
            put("serverUrl", Prefs.serverUrl(prefs))
            put("pollIntervalSec", Prefs.pollIntervalSec(prefs))
            put("localServerEnabled", Prefs.localServerEnabled(prefs))
            put("smsSent", Prefs.smsSentTotal(prefs))
            put("smsFailed", Prefs.smsFailedTotal(prefs))
            put("lastError", Prefs.lastError(prefs) ?: JSONObject.NULL)
        }
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    private fun postCheckin(
        context: Context,
        prefs: SharedPreferences,
        smsReports: List<SmsReport>,
        cmdReports: List<CmdReport>,
        log: (String) -> Unit,
    ): CheckinResponse? {
        val endpoint = "${Prefs.serverUrl(prefs)}/api/v1/fleet/checkin"
        val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (_: Exception) {
            null
        }
        val payload = JSONObject().apply {
            put("deviceUuid", Prefs.deviceUuid(prefs))
            Prefs.deviceToken(prefs)?.let { put("deviceToken", it) }
            put("appVersion", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("model", Build.MODEL)
            put("manufacturer", Build.MANUFACTURER)
            put("osVersion", Build.VERSION.RELEASE)
            androidId?.let { put("androidId", it) }
            put("isDeviceOwner", false)
            put("activeTrip", false)
            Prefs.lastError(prefs)?.let { put("lastError", it.take(4000)) }
            if (smsReports.isNotEmpty()) {
                val arr = JSONArray()
                for (r in smsReports) {
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
            if (cmdReports.isNotEmpty()) {
                val arr = JSONArray()
                for (r in cmdReports) {
                    arr.put(
                        JSONObject().apply {
                            put("commandId", r.commandId)
                            put("status", r.status)
                            r.resultJson?.let { put("result", JSONObject(it)) }
                            r.error?.let { put("error", it.take(4000)) }
                        },
                    )
                }
                put("remoteCommandReports", arr)
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
                Prefs.setLastError(prefs, "check-in HTTP $code")
                return null
            }
            parseResponse(text)
        } catch (e: Exception) {
            log("✗ check-in error: ${e.message}")
            Prefs.setLastError(prefs, "check-in: ${e.message}")
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

        val commands = ArrayList<RemoteCommand>()
        json.optJSONArray("pendingCommands")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                commands += RemoteCommand(o.getString("id"), o.getString("type"))
            }
        }
        return CheckinResponse(tokenIssued, pending, commands)
    }

    // ── Persisted queues (survive an app/OS kill between cycles) ────────────────

    private fun loadSmsReports(prefs: SharedPreferences): List<SmsReport> {
        val raw = prefs.getString(Prefs.KEY_PENDING_REPORTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                SmsReport(o.getString("id"), o.getString("status"), o.optString("error", "").ifBlank { null })
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun saveSmsReports(prefs: SharedPreferences, reports: List<SmsReport>) {
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

    private fun loadCmdReports(prefs: SharedPreferences): List<CmdReport> {
        val raw = prefs.getString(Prefs.KEY_REMOTE_COMMAND_REPORTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                CmdReport(
                    o.getString("commandId"),
                    o.getString("status"),
                    if (o.has("result")) o.getJSONObject("result").toString() else null,
                    o.optString("error", "").ifBlank { null },
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun saveCmdReports(prefs: SharedPreferences, reports: List<CmdReport>) {
        val arr = JSONArray()
        for (r in reports) {
            arr.put(
                JSONObject().apply {
                    put("commandId", r.commandId)
                    put("status", r.status)
                    r.resultJson?.let { put("result", JSONObject(it)) }
                    r.error?.let { put("error", it) }
                },
            )
        }
        prefs.edit().putString(Prefs.KEY_REMOTE_COMMAND_REPORTS, arr.toString()).apply()
    }

    private fun loadExecutedIds(prefs: SharedPreferences): Set<String> {
        val raw = prefs.getString(Prefs.KEY_EXECUTED_COMMAND_IDS, null) ?: return emptySet()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }.toSet()
        } catch (_: Exception) {
            emptySet()
        }
    }

    /** Append an executed command id, keeping only the most recent 100. */
    private fun addExecutedId(prefs: SharedPreferences, id: String) {
        val current = loadExecutedIds(prefs).toMutableList()
        current.add(id)
        val trimmed = if (current.size > 100) current.subList(current.size - 100, current.size) else current
        prefs.edit().putString(Prefs.KEY_EXECUTED_COMMAND_IDS, JSONArray(trimmed).toString()).apply()
    }
}
