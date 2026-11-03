package com.ds4bridge.controller

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager

/**
 * Keeps streaming healthy while the gamepad is in use:
 *  - holds a [WifiManager.WifiLock] (FULL_LOW_LATENCY on Android 10+, FULL_HIGH_PERF before) so the
 *    Wi-Fi radio does not power-save between 120 Hz packets,
 *  - holds a PARTIAL wake lock so the CPU keeps running the sender and sensor threads,
 *  - watches the default network and reports Wi-Fi <-> cellular switches, IP changes and loss.
 *
 * [onNetworkEvent] receives a human-readable status (null = all good) and whether the sender should
 * re-open its sockets. It is called on a connectivity thread and must be non-blocking.
 *
 * Needs: WAKE_LOCK, ACCESS_WIFI_STATE, ACCESS_NETWORK_STATE (declared in the manifest).
 */
class ConnectionKeeper(
    context: Context,
    private val onNetworkEvent: (status: String?, reconnect: Boolean) -> Unit
) {
    private val appContext = context.applicationContext
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var callback: ConnectivityManager.NetworkCallback? = null

    private var lastKind = ""
    private var lastAddresses = ""

    @Suppress("DEPRECATION")
    fun start() {
        if (callback != null) return
        runCatching {
            val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            } else {
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            }
            wifiLock = wifi.createWifiLock(mode, "ds4bridge:wifi").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        runCatching {
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ds4bridge:stream").apply {
                setReferenceCounted(false)
                acquire(6L * 60L * 60L * 1000L) // safety timeout; released in stop()
            }
        }
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    evaluate(cm.getNetworkCapabilities(network), cm.getLinkProperties(network))
                }

                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    evaluate(caps, cm.getLinkProperties(network))
                }

                override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) {
                    evaluate(cm.getNetworkCapabilities(network), lp)
                }

                override fun onLost(network: Network) {
                    lastKind = "none"
                    onNetworkEvent("No network connection. Reconnecting automatically when Wi-Fi or USB returns.", false)
                }
            }
            cm.registerDefaultNetworkCallback(cb)
            callback = cb
        }
    }

    fun stop() {
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            callback?.let { cm.unregisterNetworkCallback(it) }
        }
        callback = null
        runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
        wifiLock = null
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
        lastKind = ""
        lastAddresses = ""
    }

    private fun evaluate(caps: NetworkCapabilities?, lp: LinkProperties?) {
        val kind = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
        val addresses = lp?.linkAddresses?.joinToString(",") { it.address.hostAddress ?: "" } ?: ""
        val kindChanged = kind != lastKind
        val addressChanged = addresses != lastAddresses && lastAddresses.isNotEmpty()
        lastKind = kind
        lastAddresses = addresses

        if (kind == "cellular") {
            onNetworkEvent(
                "Phone switched to mobile data. The PC is reachable over Wi-Fi or USB only; plug in USB or reconnect Wi-Fi.",
                false
            )
        } else if (kindChanged || addressChanged) {
            // Back on Wi-Fi/Ethernet, or our IP changed: drop old sockets and re-pair
            onNetworkEvent(null, true)
        }
    }
}
