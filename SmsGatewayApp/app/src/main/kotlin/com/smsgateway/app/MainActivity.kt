package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.smsgateway.app.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    private val requestPerms = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result["android.permission.SEND_SMS"] == true) {
            appendLog("✓ Permisiune SEND_SMS acordată")
        } else {
            appendLog("✗ Permisiune SEND_SMS REFUZATĂ – SMS-urile nu vor funcționa")
            Toast.makeText(this, "Permisiunea SEND_SMS este necesară", Toast.LENGTH_LONG).show()
        }
    }

    private val logReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action != SmsGatewayService.ACTION_LOG) return
            val msg = intent.getStringExtra(SmsGatewayService.EXTRA_LOG_MSG) ?: return
            appendLog(msg)
            refreshStatus()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs.of(this)

        // Populate fields from prefs.
        binding.serverUrlInput.setText(Prefs.serverUrl(prefs))
        binding.intervalInput.setText(Prefs.pollIntervalSec(prefs).toString())
        binding.localServerSwitch.isChecked = Prefs.localServerEnabled(prefs)
        binding.apiKeyInput.setText(prefs.getString(Prefs.KEY_API_KEY, Prefs.DEFAULT_API_KEY))
        binding.portText.text = "Port: ${SmsGatewayService.PORT}"
        binding.ipText.text = "IP: ${NetUtils.getLocalIp(this) ?: "—"}"

        binding.saveBtn.setOnClickListener { saveSettings() }
        binding.startBtn.setOnClickListener { startService() }
        binding.stopBtn.setOnClickListener { stopService() }
        binding.clearLogBtn.setOnClickListener { binding.logText.text = "" }

        ensurePermissions()
        requestBatteryOptimizationExemption()
        refreshStatus()

        // Reopened after an OEM kill while the operator had the gateway ON → bring it back.
        if (Prefs.serviceEnabled(prefs) && !SmsGatewayService.isRunning) startService()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            logReceiver,
            IntentFilter(SmsGatewayService.ACTION_LOG),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        refreshStatus()
    }

    override fun onStop() {
        try {
            unregisterReceiver(logReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }

    private fun saveSettings() {
        val url = binding.serverUrlInput.text.toString().trim().trimEnd('/')
        if (url.isBlank()) {
            Toast.makeText(this, "Server URL nu poate fi gol", Toast.LENGTH_LONG).show()
            return
        }
        val interval = binding.intervalInput.text.toString().trim().toIntOrNull()
            ?.coerceIn(5, 3600) ?: Prefs.DEFAULT_POLL_INTERVAL_SEC
        val apiKey = binding.apiKeyInput.text.toString().trim()

        prefs.edit()
            .putString(Prefs.KEY_SERVER_URL, url)
            .putInt(Prefs.KEY_POLL_INTERVAL_SEC, interval)
            .putBoolean(Prefs.KEY_LOCAL_SERVER_ENABLED, binding.localServerSwitch.isChecked)
            .putString(Prefs.KEY_API_KEY, apiKey)
            .apply()

        // Reflect the coerced interval back into the field.
        binding.intervalInput.setText(interval.toString())
        Toast.makeText(this, "Setări salvate", Toast.LENGTH_SHORT).show()
        appendLog("🔧 Setări salvate (repornește serviciul ca să aplici)")
    }

    private fun ensurePermissions() {
        val needed = ArrayList<String>()
        if (ContextCompat.checkSelfPermission(this, "android.permission.SEND_SMS") != 0) {
            needed.add("android.permission.SEND_SMS")
        }
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != 0
        ) {
            needed.add("android.permission.POST_NOTIFICATIONS")
        }
        if (needed.isNotEmpty()) requestPerms.launch(needed.toTypedArray())
    }

    private fun requestBatteryOptimizationExemption() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                startActivity(
                    Intent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS")
                        .setData(Uri.parse("package:$packageName")),
                )
            }
        } catch (_: Exception) {
        }
    }

    private fun startService() {
        Prefs.setServiceEnabled(prefs, true)
        // Re-prompt for the battery exemption if it was dismissed/revoked — critical on
        // Samsung where "Deep sleep" otherwise kills the poll loop.
        requestBatteryOptimizationExemption()
        val i = Intent(this, SmsGatewayService::class.java).setAction(SmsGatewayService.ACTION_START)
        startForegroundService(i)
        appendLog("⟳ Pornire serviciu...")
    }

    private fun stopService() {
        Prefs.setServiceEnabled(prefs, false)
        val i = Intent(this, SmsGatewayService::class.java).setAction(SmsGatewayService.ACTION_STOP)
        startService(i)
    }

    private fun refreshStatus() {
        binding.ipText.text = "IP: ${NetUtils.getLocalIp(this) ?: "—"}"

        val registered = Prefs.deviceToken(prefs) != null
        val uuid = Prefs.deviceUuid(prefs)
        binding.deviceStatusText.text =
            "Device: ${uuid.take(8)}…  ·  ${if (registered) "înregistrat" else "neînregistrat"}"

        val running = SmsGatewayService.isRunning
        val battOptOk = try {
            (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        } catch (_: Exception) {
            false
        }
        val battLine = if (battOptOk) {
            "🔋 Baterie: nerestricționată ✓"
        } else {
            "⚠ Baterie: OPTIMIZARE ACTIVĂ — poate opri serviciul (setează „Nerestricționat”)"
        }
        binding.statusText.text = if (running) {
            "Status: RULEAZĂ  →  pull ${Prefs.serverUrl(prefs)}\n$battLine"
        } else {
            "Status: OPRIT\n$battLine"
        }
        binding.startBtn.isEnabled = !running
        binding.stopBtn.isEnabled = running
    }

    private fun appendLog(msg: String) {
        val ts = timeFmt.format(Date())
        val old = binding.logText.text
        binding.logText.text = "[$ts] $msg\n$old"
    }
}
