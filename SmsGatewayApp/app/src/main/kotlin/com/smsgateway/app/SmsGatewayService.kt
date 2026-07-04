package com.smsgateway.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps the gateway alive. It runs two transports:
 *   - **pull mode** (primary): a coroutine poll loop calling [CheckinClient.poll];
 *   - **legacy push** (optional, default OFF): the [HttpServer] on :8080.
 *
 * A partial WakeLock + the foreground notification keep polling running with the
 * screen off. On a dedicated, charging gateway phone that is enough; add a boot
 * receiver / Device-Owner battery whitelist for fully unattended operation.
 */
class SmsGatewayService : Service() {

    companion object {
        const val ACTION_START = "com.smsgateway.app.START"
        const val ACTION_STOP = "com.smsgateway.app.STOP"
        const val ACTION_LOG = "com.smsgateway.app.LOG"
        const val EXTRA_LOG_MSG = "log_msg"
        const val PORT = 8080
        private const val CHANNEL_ID = "sms_gateway_channel"
        private const val NOTIF_ID = 1337

        @Volatile
        var isRunning = false
            private set
    }

    private lateinit var prefs: SharedPreferences
    private var server: HttpServer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs.of(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverythingAndSelf()
            return START_NOT_STICKY
        }
        start()
        return START_STICKY
    }

    private fun start() {
        if (isRunning) return
        // Persist intent so BootReceiver/WatchdogReceiver auto-restart after reboot/kill.
        Prefs.setServiceEnabled(prefs, true)
        startForeground(NOTIF_ID, buildNotification("Pornire..."))
        acquireWakeLock()
        isRunning = true
        AlarmScheduler.schedule(this)

        if (Prefs.localServerEnabled(prefs)) startLocalServer()

        val uuid = Prefs.deviceUuid(prefs)
        broadcastLog("⟳ Pull mode → ${Prefs.serverUrl(prefs)}  (device ${uuid.take(8)}…)")
        pollJob = scope.launch {
            while (isActive) {
                try {
                    CheckinClient.poll(applicationContext, prefs) { broadcastLog(it) }
                } catch (e: Exception) {
                    broadcastLog("✗ poll: ${e.message}")
                }
                updateNotification(statusLine())
                delay(Prefs.pollIntervalSec(prefs) * 1000L)
            }
        }
        updateNotification(statusLine())
    }

    private fun statusLine(): String {
        val base = "Pull: ${Prefs.serverUrl(prefs)}"
        return if (server != null) "$base + local :$PORT" else base
    }

    private fun startLocalServer() {
        if (server != null) return
        try {
            val s = HttpServer(
                applicationContext,
                PORT,
                getApiKey = { Prefs.apiKey(prefs) },
                logger = { broadcastLog(it) },
            )
            s.start(60_000, false)
            server = s
            val ip = NetUtils.getLocalIp(this) ?: "—"
            broadcastLog("✓ Server local pornit pe $ip:$PORT")
        } catch (e: Exception) {
            broadcastLog("✗ Server local: ${e.message}")
        }
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SmsGateway::ServerWakeLock").apply {
                setReferenceCounted(false)
                acquire(24L * 60 * 60 * 1000) // 24h; the service re-acquires while alive
            }
        } catch (_: Exception) {
        }
    }

    private fun stopEverythingAndSelf() {
        // Operator-requested stop: clear the auto-restart intent + cancel the watchdog.
        Prefs.setServiceEnabled(prefs, false)
        AlarmScheduler.cancel(this)
        pollJob?.cancel()
        pollJob = null
        try {
            server?.stop()
        } catch (_: Exception) {
        }
        server = null
        isRunning = false
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wakeLock = null
        broadcastLog("■ Oprit")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun broadcastLog(msg: String) {
        LogBuffer.add(msg) // keep a tail for the fetch_logs remote command
        val i = Intent(ACTION_LOG).setPackage(packageName).putExtra(EXTRA_LOG_MSG, msg)
        sendBroadcast(i)
    }

    private fun createNotificationChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "SMS Gateway", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Canal pentru serviciul SMS Gateway"
        ch.setShowBadge(false)
        (getSystemService(NotificationManager::class.java)).createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val openPi = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopPi = PendingIntent.getService(
            this,
            1,
            Intent(this, SmsGatewayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SMS Gateway activ")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentIntent(openPi)
            .addAction(android.R.drawable.ic_delete, "Oprește", stopPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        (getSystemService(NotificationManager::class.java)).notify(NOTIF_ID, buildNotification(text))
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // App swiped from Recents: the OS may kill this service. Re-arm the watchdog so
        // it gets restarted (START_STICKY alone is unreliable on some OEMs).
        if (Prefs.serviceEnabled(prefs)) AlarmScheduler.schedule(applicationContext)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        pollJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }
}
