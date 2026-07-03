package com.smsgateway.app

import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Thread-safe in-memory ring buffer of recent log lines (the same lines shown in
 * the UI). Feeds the `fetch_logs` remote command, which returns the tail inline in
 * its result — no filesystem, no authenticated upload endpoint needed.
 */
object LogBuffer {
    private const val MAX = 300
    private val fmt = SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault())
    private val lines = ArrayDeque<String>()

    @Synchronized
    fun add(msg: String) {
        lines.addLast("[${fmt.format(Date())}] $msg")
        while (lines.size > MAX) lines.removeFirst()
    }

    /** The most recent [n] lines, oldest-first. */
    @Synchronized
    fun tail(n: Int): List<String> {
        val all = lines.toList()
        return if (n >= all.size) all else all.subList(all.size - n, all.size)
    }
}
