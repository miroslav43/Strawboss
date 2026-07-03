package com.smsgateway.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Legacy **push** transport: an embedded HTTP server the backend reaches at
 * `http://<phone-ip>:8080/send-sms`. Kept for LAN / manual testing but **off by
 * default** — the primary transport is now pull mode ([CheckinClient]).
 *
 * Faithful Kotlin port of the original APK. Endpoints:
 *   POST /send-sms   {"apiKey","phone","message"}  → sends SMS
 *   GET  /status | /health                          → server stats
 */
class HttpServer(
    private val context: Context,
    port: Int,
    private val getApiKey: () -> String,
    private val logger: (String) -> Unit,
) : NanoHTTPD(port) {

    private val rateLimitMaxPerMinute = 5
    private val rateLimitWindowMs = 60_000L

    // A send payload is a tiny JSON ({apiKey, phone, message<=1000}). Cap the
    // declared body size so a malicious/huge Content-Length can't OOM the app.
    private val maxBodyBytes = 16 * 1024
    private val sendTimestamps = ArrayDeque<Long>()
    private val startTime = System.currentTimeMillis()
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    @Volatile
    var requestCount = 0
        private set

    @Volatile
    var smsSentCount = 0
        private set

    @Volatile
    var smsFailedCount = 0
        private set

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        val method = session.method
        if (uri != "/health") {
            log("→ $method $uri from ${session.remoteIpAddress}")
        }
        requestCount++
        return when {
            method == Method.POST && uri == "/send-sms" -> handleSendSms(session)
            method == Method.GET && uri == "/status" -> handleHealth()
            method == Method.GET && uri == "/health" -> handleHealth()
            method == Method.GET && uri == "/" ->
                json(200, mapOf("success" to true, "service" to "SMS Gateway"))
            else -> json(404, mapOf("success" to false, "error" to "Not found"))
        }
    }

    private fun handleSendSms(session: IHTTPSession): Response {
        val body: String = try {
            val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
            if (contentLength > maxBodyBytes) {
                log("✗ Body too large ($contentLength bytes) from ${session.remoteIpAddress}")
                return json(413, mapOf("success" to false, "error" to "Payload too large"))
            }
            if (contentLength > 0) {
                val bytes = ByteArray(contentLength)
                var totalRead = 0
                while (totalRead < contentLength) {
                    val read = session.inputStream.read(bytes, totalRead, contentLength - totalRead)
                    if (read == -1) break
                    totalRead += read
                }
                String(bytes, 0, totalRead, Charsets.UTF_8).trim()
            } else {
                val files = HashMap<String, String>()
                session.parseBody(files)
                (files["postData"] ?: "").trim()
            }
        } catch (e: Exception) {
            log("Body parse error: ${e.message}")
            return json(400, mapOf("success" to false, "error" to "Invalid request body"))
        }

        if (body.isBlank()) {
            return json(400, mapOf("success" to false, "error" to "Empty body"))
        }

        return try {
            val payload = JSONObject(body)
            val apiKey = payload.optString("apiKey", "")
            val phone = payload.optString("phone", "").trim()
            val message = payload.optString("message", "")

            val expectedKey = getApiKey()
            if (expectedKey.isBlank()) {
                return json(500, mapOf("success" to false, "error" to "Server API key not configured"))
            }
            if (apiKey != expectedKey) {
                log("✗ Invalid API key from ${session.remoteIpAddress}")
                return json(401, mapOf("success" to false, "error" to "Invalid API key"))
            }
            if (!SmsSender.isValidPhone(phone)) {
                return json(400, mapOf("success" to false, "error" to "Invalid phone number"))
            }
            if (message.isBlank()) {
                return json(400, mapOf("success" to false, "error" to "Message is empty"))
            }
            if (message.length > 1000) {
                return json(400, mapOf("success" to false, "error" to "Message too long (max 1000 chars)"))
            }
            if (!allowRate()) {
                log("✗ Rate limit exceeded")
                return json(
                    429,
                    mapOf("success" to false, "error" to "Rate limit: max $rateLimitMaxPerMinute SMS/minute"),
                )
            }

            // SmsManager wants a Looper thread; hop to the main thread and wait.
            val resultHolder = arrayOfNulls<Pair<Boolean, String?>>(1)
            val lock = Object()
            Handler(Looper.getMainLooper()).post {
                resultHolder[0] = SmsSender.sendSms(context, phone, message)
                synchronized(lock) { lock.notifyAll() }
            }
            synchronized(lock) {
                if (resultHolder[0] == null) lock.wait(10_000L)
            }
            val result = resultHolder[0] ?: (false to "Timeout sending SMS")

            if (result.first) {
                smsSentCount++
                log("✓ SMS sent to $phone")
                json(200, mapOf("success" to true))
            } else {
                smsFailedCount++
                log("✗ SMS failed to $phone: ${result.second}")
                json(500, mapOf("success" to false, "error" to (result.second ?: "Unknown error")))
            }
        } catch (e: Exception) {
            log("JSON parse error: ${e.message} | body='${body.take(100)}'")
            json(400, mapOf("success" to false, "error" to "Invalid JSON: ${e.message}"))
        }
    }

    private fun handleHealth(): Response {
        val uptimeMs = System.currentTimeMillis() - startTime
        val uptimeSec = uptimeMs / 1000
        val h = uptimeSec / 3600
        val m = (uptimeSec % 3600) / 60
        val s = uptimeSec % 60
        return json(
            200,
            mapOf(
                "success" to true,
                "status" to "running",
                "uptime" to "${h}h ${m}m ${s}s",
                "uptimeMs" to uptimeMs,
                "smsSent" to smsSentCount,
                "smsFailed" to smsFailedCount,
                "requests" to requestCount,
                "timestamp" to dateFmt.format(Date()),
                "port" to listeningPort,
            ),
        )
    }

    @Synchronized
    private fun allowRate(): Boolean {
        val now = System.currentTimeMillis()
        while (sendTimestamps.isNotEmpty() && now - sendTimestamps.first > rateLimitWindowMs) {
            sendTimestamps.removeFirst()
        }
        if (sendTimestamps.size >= rateLimitMaxPerMinute) return false
        sendTimestamps.addLast(now)
        return true
    }

    private fun json(status: Int, data: Map<String, Any?>): Response {
        val s = when (status) {
            200 -> Response.Status.OK
            400 -> Response.Status.BAD_REQUEST
            401 -> Response.Status.UNAUTHORIZED
            404 -> Response.Status.NOT_FOUND
            413 -> Response.Status.lookup(413) ?: Response.Status.BAD_REQUEST
            429 -> Response.Status.lookup(429) ?: Response.Status.BAD_REQUEST
            500 -> Response.Status.INTERNAL_ERROR
            else -> Response.Status.OK
        }
        val res = newFixedLengthResponse(s, "application/json; charset=utf-8", JSONObject(data).toString())
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    private fun log(msg: String) = logger(msg)
}
