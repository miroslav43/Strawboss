package com.smsgateway.app

import android.content.Context
import android.os.Build
import android.telephony.SmsManager

/**
 * Sends SMS via the device SIM. Recovered from the original APK unchanged.
 *
 * Returns `(true, null)` on success or `(false, errorMessage)` on failure. Long
 * messages are split into multipart automatically.
 */
object SmsSender {

    fun sendSms(context: Context, phone: String, message: String): Pair<Boolean, String?> {
        return try {
            val smsManager: SmsManager =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    context.getSystemService(SmsManager::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    SmsManager.getDefault()
                }

            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phone, null, message, null, null)
            }
            true to null
        } catch (e: Exception) {
            false to (e.message ?: "Unknown SMS error")
        }
    }

    fun isValidPhone(phone: String): Boolean {
        val cleaned = phone.trim()
        return Regex("^\\+?[0-9]{8,15}$").matches(cleaned)
    }
}
