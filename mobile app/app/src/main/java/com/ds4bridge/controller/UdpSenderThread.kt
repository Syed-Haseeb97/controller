package com.ds4bridge.controller

import android.os.Build
import android.os.Process
import android.os.SystemClock
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.LockSupport

enum class TransportMode {
    USB_ADB_REVERSE,
    WIFI_UDP
}

/**
 * PAIRING HANDSHAKE (the 48-byte controller packet is NOT changed):
 *  1. The PC QR code carries ds4udp://ip:port?token=<hex>.
 *  2. Before any controller packet the phone sends ONE small auth packet = MAGIC + token
 *     [+ "|" + phone name] (UDP: one datagram; USB/TCP: the same bytes followed by "\n" for framing).
 *     It is never 48 bytes long, so it can't be mistaken for controller data.
 *  3. The PC checks it with hmac.compare_digest and then accepts controller packets only from
 *     this exact IP + source port (or this TCP connection). The phone repeats the auth about
 *     once per second so it re-pairs after a PC restart or a socket change.
 *  4. Optional PC trust list: a phone name must be approved on the PC when strict mode is on.
 */
object PairingAuth {
    private val MAGIC = "DS4AUTH:".toByteArray(Charsets.US_ASCII)
    private const val NAME_MAX = 20

    /** Phone name as shown in the PC trust list (ASCII letters/digits/space/-_. only, max 20). */
    fun defaultDeviceName(): String =
        sanitize("${Build.MANUFACTURER} ${Build.MODEL}".trim())

    fun sanitize(name: String): String =
        name.filter { it.isLetterOrDigit() && it.code < 128 || it == ' ' || it == '-' || it == '_' || it == '.' }
            .trim().take(NAME_MAX)

    fun datagram(token: String, name: String = ""): ByteArray {
        val clean = sanitize(name)
        val body = MAGIC + token.toByteArray(Charsets.US_ASCII)
        return if (clean.isEmpty()) body else body + "|".toByteArray(Charsets.US_ASCII) + clean.toByteArray(Charsets.US_ASCII)
    }

    fun streamLine(token: String, name: String = ""): ByteArray =
        datagram(token, name) + byteArrayOf('\n'.code.toByte())
}

/**
 * Dedicated high-priority Dual-Transport (USB `adb reverse` + Wi-Fi UDP) sender:
 *  - A separate probe thread connects to `127.0.0.1:26761` (tunneled by the PC's `adb reverse`), so the
 *    120 Hz loop never blocks on a connect. USB wins as soon as it exists; unplugging falls back to
 *    Wi-Fi in the same frame (the failed USB write is retried over UDP immediately).
 *  - RTT comes ONLY from real data: the PC echoes our timestamp in 16-byte `<IQBBBB` frames. Unknown = -1.
 *  - PC ping frames (echo seq 0xFFFFFFFF) are answered with a 48-byte pong carrying the PC timestamp,
 *    letting the PC measure RTT itself on the same transport. Pongs never carry controller input.
 *  - Socket errors never crash the thread: exponential backoff (0.25 s .. 5 s), socket re-creation, and
 *    three neutral frames after any drop so nothing is stuck on the PC.
 *  - The hot loop allocates nothing: reusable frame, byte buffers and DatagramPackets.
 */
class UdpSenderThread(
    private val fillState: (MutableControllerState) -> Unit,
    private val hapticsManager: HapticsAndRumbleManager? = null,
    private val deviceName: String = "",
    private val onStatsUpdate: (
        sentHz: Float,
        seq: Long,
        mode: TransportMode,
        rttMs: Float,
        lastError: String?
    ) -> Unit
) {
    companion object {
        const val FEEDBACK_PACKET_SIZE = 16 // `<IQBBBB`: seq(4), ts_us(8), large(1), small(1), r(1), b(1)
        private const val NO_REPLY_AFTER_NS = 2_000_000_000L
        private const val MAX_BACKOFF_MS = 5_000L
    }

    private class UsbLink(val socket: Socket, val out: OutputStream)

    private val running = AtomicBoolean(false)
    private val targetHostRef = AtomicReference("")
    private val targetPortRef = AtomicInteger(26760)
    private val usbPortRef = AtomicInteger(26761)
    private val rateHzRef = AtomicInteger(120)
    private val autoUsbEnabledRef = AtomicBoolean(true)
    private val pairingTokenRef = AtomicReference("")
    private val usbLinkRef = AtomicReference<UsbLink?>(null)
    private val udpSocketRef = AtomicReference<DatagramSocket?>(null)
    private val reconnectRequested = AtomicBoolean(false)

    // RTT ping/pong: single-slot mailbox filled by the feedback readers, drained by the sender loop
    private val pongPending = AtomicBoolean(false)
    @Volatile private var pongTimestampUs: Long = 0L
    @Volatile private var pongId: Int = 0

    @Volatile private var latestRttMs: Float = -1f
    @Volatile private var lastFeedbackWallNs: Long = 0L
    @Volatile private var activeMode: TransportMode = TransportMode.WIFI_UDP

    private var workerThread: Thread? = null
    private var feedbackThread: Thread? = null
    private var usbProbeThread: Thread? = null

    private val phoneName: String = PairingAuth.sanitize(deviceName.ifBlank { PairingAuth.defaultDeviceName() })

    fun configureEndpoint(
        host: String,
        port: Int,
        rateHz: Int = 120,
        autoUsb: Boolean = true,
        token: String = ""
    ) {
        val changed = host.trim() != targetHostRef.get() || port.coerceIn(1024, 65535) != targetPortRef.get() ||
            token.trim() != pairingTokenRef.get()
        targetHostRef.set(host.trim())
        targetPortRef.set(port.coerceIn(1024, 65535))
        rateHzRef.set(rateHz.coerceIn(30, 250))
        autoUsbEnabledRef.set(autoUsb)
        pairingTokenRef.set(token.trim())
        if (changed) requestReconnect()
    }

    /** Called when the network or IP changed: re-open sockets, re-resolve the host, re-send auth. */
    fun requestReconnect() {
        reconnectRequested.set(true)
    }

    /**
     * Connection test using the REAL handshake: auth packet first, then a real 48-byte packet; waits up to
     * [timeoutMs] for the PC's 16-byte echo and only succeeds if the echo carries the exact sequence and
     * timestamp we sent. RTT = measured wall-clock time. PC ping frames arriving first are skipped.
     */
    fun runRealConnectionTest(
        host: String,
        port: Int,
        useUsb: Boolean,
        token: String = pairingTokenRef.get(),
        timeoutMs: Int = 2000,
        onResult: (Result<Float>) -> Unit
    ) {
        Thread({
            val packetBytes = ByteArray(ControllerState.PACKET_SIZE_BYTES)
            val packetBuf = ByteBuffer.wrap(packetBytes)
            val sentSeq = 777_777L

            if (useUsb) {
                try {
                    Socket().use { s ->
                        s.tcpNoDelay = true
                        s.soTimeout = timeoutMs
                        s.connect(InetSocketAddress("127.0.0.1", usbPortRef.get()), 400)
                        val out = s.getOutputStream()
                        if (token.isNotEmpty()) out.write(PairingAuth.streamLine(token, phoneName))
                        val sendNs = SystemClock.elapsedRealtimeNanos()
                        ControllerState().writeToBuffer(packetBuf, seq = sentSeq, timestampUs = sendNs / 1_000L)
                        out.write(packetBytes)
                        out.flush()
                        val rtt = awaitEcho(s.getInputStream(), sentSeq, sendNs / 1_000L, sendNs, timeoutMs)
                        latestRttMs = rtt
                        lastFeedbackWallNs = SystemClock.elapsedRealtimeNanos()
                        onResult(Result.success(rtt))
                        return@Thread
                    }
                } catch (e: Exception) {
                    if (host.isBlank()) {
                        onResult(
                            Result.failure(
                                IllegalStateException(
                                    "USB tunnel (127.0.0.1:${usbPortRef.get()}) did not answer (${e.javaClass.simpleName}: ${e.message ?: "no detail"}). " +
                                        "Fixes: enable USB debugging, plug in the cable, accept the debugging prompt, run the PC app (it creates `adb reverse`), and make sure ViGEmBus is installed."
                                )
                            )
                        )
                        return@Thread
                    }
                    // else: fall through and test Wi-Fi instead
                }
            }

            val trimmedHost = host.trim()
            if (trimmedHost.isEmpty()) {
                onResult(Result.failure(IllegalArgumentException("PC IP address is empty. Enter the PC LAN IP or scan the pairing QR code.")))
                return@Thread
            }

            try {
                val addr = InetAddress.getByName(trimmedHost)
                DatagramSocket().use { sock ->
                    sock.trafficClass = 0x10
                    sock.soTimeout = 250
                    if (token.isNotEmpty()) {
                        val authBytes = PairingAuth.datagram(token, phoneName)
                        sock.send(DatagramPacket(authBytes, authBytes.size, addr, port))
                    }
                    val sendNs = SystemClock.elapsedRealtimeNanos()
                    ControllerState().writeToBuffer(packetBuf, seq = sentSeq, timestampUs = sendNs / 1_000L)
                    sock.send(DatagramPacket(packetBytes, packetBytes.size, addr, port))

                    val recvBuf = ByteArray(64)
                    val recvPkt = DatagramPacket(recvBuf, recvBuf.size)
                    val deadlineNs = sendNs + timeoutMs * 1_000_000L
                    var lastOddLength = -1
                    while (SystemClock.elapsedRealtimeNanos() < deadlineNs) {
                        recvPkt.length = recvBuf.size
                        try {
                            sock.receive(recvPkt)
                        } catch (_: SocketTimeoutException) {
                            continue
                        }
                        if (recvPkt.length != FEEDBACK_PACKET_SIZE) {
                            lastOddLength = recvPkt.length
                            continue
                        }
                        val bb = ByteBuffer.wrap(recvBuf, 0, FEEDBACK_PACKET_SIZE).order(ByteOrder.LITTLE_ENDIAN)
                        val echoSeq = bb.int.toLong() and 0xFFFFFFFFL
                        val echoTs = bb.long
                        if (echoSeq == sentSeq && echoTs == sendNs / 1_000L) {
                            val rtt = (SystemClock.elapsedRealtimeNanos() - sendNs) / 1_000_000f
                            latestRttMs = rtt
                            lastFeedbackWallNs = SystemClock.elapsedRealtimeNanos()
                            onResult(Result.success(rtt))
                            return@Thread
                        }
                    }
                    val odd = if (lastOddLength > 0) " (received a $lastOddLength-byte reply, expected 16)" else ""
                    throw SocketTimeoutException("no valid 16-byte echo$odd")
                }
            } catch (_: UnknownHostException) {
                onResult(Result.failure(IllegalStateException("Wrong IP address: '$trimmedHost' could not be resolved. Use the IP shown in the PC tray app.")))
            } catch (e: SocketTimeoutException) {
                onResult(
                    Result.failure(
                        IllegalStateException(
                            "Timed out after ${timeoutMs / 1000}s: ${e.message ?: "no echo"} from $trimmedHost:$port. " +
                                "Check, in this order: (1) PC app running and its IP is $trimmedHost, (2) phone and PC on the same Wi-Fi " +
                                "(guest/isolated networks block this), (3) Windows Firewall: click 'Add firewall rule' in the PC wizard, " +
                                "(4) pairing token matches (re-scan the QR; 'Reset pairing' changes it), (5) phone is trusted if the PC trust list is strict, " +
                                "(6) ViGEmBus installed on the PC."
                        )
                    )
                )
            } catch (e: Exception) {
                onResult(
                    Result.failure(
                        IllegalStateException(
                            "Network error (${e.localizedMessage ?: e.javaClass.simpleName}). Verify Wi-Fi is connected, the UDP port $port is allowed through the PC firewall, and the PC app is running."
                        )
                    )
                )
            }
        }, "Ds4ConnTest").start()
    }

    /** Reads 16-byte frames from [input] until the exact echo of ([seq], [tsUs]) arrives or time runs out. */
    private fun awaitEcho(input: InputStream, seq: Long, tsUs: Long, sendNs: Long, timeoutMs: Int): Float {
        val frame = ByteArray(FEEDBACK_PACKET_SIZE)
        val bb = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN)
        val deadlineNs = sendNs + timeoutMs * 1_000_000L
        while (SystemClock.elapsedRealtimeNanos() < deadlineNs) {
            var read = 0
            while (read < FEEDBACK_PACKET_SIZE) {
                val n = input.read(frame, read, FEEDBACK_PACKET_SIZE - read)
                if (n < 0) throw SocketTimeoutException("USB socket closed by the PC before any echo (pairing token rejected, phone not trusted, or receiver stopped)")
                read += n
            }
            bb.rewind()
            val echoSeq = bb.int.toLong() and 0xFFFFFFFFL
            val echoTs = bb.long
            if (echoSeq == seq && echoTs == tsUs) {
                return (SystemClock.elapsedRealtimeNanos() - sendNs) / 1_000_000f
            }
        }
        throw SocketTimeoutException("no valid 16-byte echo")
    }

    fun start() {
        if (running.getAndSet(true)) return
        workerThread = Thread({ runLoop() }, "Ds4UdpSender-120Hz").apply {
            isDaemon = true
            start()
        }
        usbProbeThread = Thread({ usbProbeLoop() }, "Ds4UsbProbe").apply {
            isDaemon = true
            start()
        }
    }

    /** Stops all threads and closes every socket (safe to call from onDestroy/onPause). */
    fun stop() {
        running.set(false)
        workerThread?.interrupt()
        usbProbeThread?.interrupt()
        feedbackThread?.interrupt()
        usbLinkRef.getAndSet(null)?.let { runCatching { it.socket.close() } }
        udpSocketRef.getAndSet(null)?.let { runCatching { it.close() } }
        workerThread?.join(300)
        workerThread = null
        usbProbeThread = null
        feedbackThread = null
    }

    private fun openUdpSocket(): DatagramSocket {
        udpSocketRef.getAndSet(null)?.let { runCatching { it.close() } }
        val s = DatagramSocket().apply {
            runCatching { trafficClass = 0x10 } // IPTOS_LOWDELAY / DSCP: honoured where the OS/router allows
            soTimeout = 200
        }
        udpSocketRef.set(s)
        return s
    }

    private fun runLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_MORE_FAVORABLE)

        val frame = MutableControllerState()
        val packetBytes = ByteArray(ControllerState.PACKET_SIZE_BYTES)
        val byteBuffer = ByteBuffer.wrap(packetBytes)
        val pongBytes = ByteArray(ControllerState.PACKET_SIZE_BYTES)
        val pongBuffer = ByteBuffer.wrap(pongBytes)
        val dgram = DatagramPacket(packetBytes, ControllerState.PACKET_SIZE_BYTES)
        val pongDgram = DatagramPacket(pongBytes, ControllerState.PACKET_SIZE_BYTES)

        openUdpSocket()
        feedbackThread = Thread({ listenWifiFeedback() }, "Ds4UdpFeedback").apply {
            isDaemon = true
            start()
        }

        var cachedHost = ""
        var cachedAddress: InetAddress? = null
        var cachedPort = -1
        var lastAuthSentNs = 0L
        var lastTokenSent = ""
        var seq = 1L
        var neutralFrames = 3
        var failures = 0
        var retryAtNs = 0L
        var lastError: String? = null

        var statStartNs = SystemClock.elapsedRealtimeNanos()
        var packetsInWindow = 0
        var firstSendNs = 0L
        var nextDeadlineNs = statStartNs

        try {
            while (running.get() && !Thread.currentThread().isInterrupted) {
                val host = targetHostRef.get()
                val port = targetPortRef.get()
                val token = pairingTokenRef.get()
                val periodNs = 1_000_000_000L / rateHzRef.get().toLong()
                val nowNs = SystemClock.elapsedRealtimeNanos()

                if (reconnectRequested.getAndSet(false)) {
                    openUdpSocket()
                    cachedAddress = null
                    cachedHost = ""
                    lastAuthSentNs = 0L
                    failures = 0
                    retryAtNs = 0L
                    neutralFrames = 3
                    latestRttMs = -1f
                }

                if (host != cachedHost || cachedAddress == null) {
                    cachedAddress = if (host.isEmpty()) null else runCatching { InetAddress.getByName(host) }.getOrNull()
                    cachedHost = host
                    cachedPort = -1
                }
                val addr = cachedAddress
                if (addr != null && port != cachedPort) {
                    dgram.address = addr
                    dgram.port = port
                    pongDgram.address = addr
                    pongDgram.port = port
                    cachedPort = port
                }

                fillState(frame)
                if (neutralFrames > 0) {
                    frame.setNeutral()
                    neutralFrames--
                }
                frame.writeToBuffer(byteBuffer, seq = seq, timestampUs = nowNs / 1_000L)

                val sendPong = pongPending.getAndSet(false)
                if (sendPong) {
                    ControllerState.writePacket(
                        pongBuffer, ControllerState.PING_SEQ, pongTimestampUs, pongId and 0xFFFF,
                        0, 0, 0, 0, 0, 0, 0f, 0f, 0f, 0f, 0f, 0f
                    )
                }

                var sent = false

                // 1. USB (`adb reverse` TCP) wins whenever its socket is alive; a failed write retries over UDP in the same frame
                val usb = usbLinkRef.get()
                if (usb != null && !usb.socket.isClosed) {
                    try {
                        usb.out.write(packetBytes)
                        if (sendPong) usb.out.write(pongBytes)
                        sent = true
                        activeMode = TransportMode.USB_ADB_REVERSE
                    } catch (_: Exception) {
                        usbLinkRef.compareAndSet(usb, null)
                        runCatching { usb.socket.close() }
                        neutralFrames = 1
                    }
                }

                // 2. Wi-Fi UDP (auth first, repeated ~1/s), with exponential backoff after socket errors
                if (!sent && addr != null && nowNs >= retryAtNs) {
                    val sock = udpSocketRef.get()
                    if (sock != null) {
                        try {
                            if (token.isNotEmpty() && (token != lastTokenSent || (nowNs - lastAuthSentNs) > 1_000_000_000L)) {
                                val auth = PairingAuth.datagram(token, phoneName)
                                sock.send(DatagramPacket(auth, auth.size, addr, port))
                                lastTokenSent = token
                                lastAuthSentNs = nowNs
                            }
                            sock.send(dgram)
                            if (sendPong) sock.send(pongDgram)
                            sent = true
                            activeMode = TransportMode.WIFI_UDP
                            if (failures > 0) {
                                failures = 0
                                lastError = null
                                neutralFrames = 3 // first frames after recovery are neutral
                            }
                        } catch (e: Exception) {
                            failures++
                            val backoffMs = (250L shl (failures - 1).coerceAtMost(5)).coerceAtMost(MAX_BACKOFF_MS)
                            retryAtNs = nowNs + backoffMs * 1_000_000L
                            lastError = "Network error: ${e.localizedMessage ?: e.javaClass.simpleName}. Retrying in ${backoffMs / 1000f}s"
                            runCatching { openUdpSocket() }
                            lastAuthSentNs = 0L
                        }
                    }
                } else if (!sent && addr == null) {
                    lastError = if (host.isEmpty()) "No PC address set. Open Settings and scan the PC QR code." else "Cannot resolve '$host'. Check the IP address."
                }

                if (sent) {
                    seq++
                    packetsInWindow++
                    if (firstSendNs == 0L) firstSendNs = nowNs
                }

                val elapsedWindowNs = nowNs - statStartNs
                if (elapsedWindowNs >= 1_000_000_000L) {
                    if (lastFeedbackWallNs > 0L && (nowNs - lastFeedbackWallNs) > NO_REPLY_AFTER_NS) {
                        latestRttMs = -1f
                    }
                    val actualHz = (packetsInWindow * 1_000_000_000f) / elapsedWindowNs.toFloat()
                    // Something is wrong only if we send but the PC never answers
                    val silent = firstSendNs != 0L && (nowNs - firstSendNs) > NO_REPLY_AFTER_NS &&
                        (lastFeedbackWallNs == 0L || (nowNs - lastFeedbackWallNs) > NO_REPLY_AFTER_NS)
                    val status = lastError ?: if (silent && sent) {
                        "No reply from the PC. Check the pairing token, the Windows Firewall rule and that the PC app is running."
                    } else null
                    onStatsUpdate(actualHz, seq, activeMode, latestRttMs, status)
                    packetsInWindow = 0
                    statStartNs = nowNs
                }

                nextDeadlineNs += periodNs
                val sleepNs = nextDeadlineNs - SystemClock.elapsedRealtimeNanos()
                if (sleepNs > 0) {
                    LockSupport.parkNanos(sleepNs)
                } else if (sleepNs < -periodNs * 4) {
                    nextDeadlineNs = SystemClock.elapsedRealtimeNanos() // resync after a pause
                }
            }
        } catch (_: InterruptedException) {
            // normal shutdown
        } finally {
            usbLinkRef.getAndSet(null)?.let { runCatching { it.socket.close() } }
            udpSocketRef.getAndSet(null)?.let { runCatching { it.close() } }
        }
    }

    /** Probes `127.0.0.1:<usbPort>` off the hot loop; publishes a ready, authenticated link. */
    private fun usbProbeLoop() {
        while (running.get() && !Thread.currentThread().isInterrupted) {
            try {
                if (!autoUsbEnabledRef.get()) {
                    usbLinkRef.getAndSet(null)?.let { runCatching { it.socket.close() } }
                } else if (usbLinkRef.get() == null) {
                    val link = tryConnectUsbTunnel(usbPortRef.get(), pairingTokenRef.get())
                    if (link != null) usbLinkRef.set(link)
                }
                Thread.sleep(1_200)
            } catch (_: InterruptedException) {
                return
            } catch (_: Exception) {
                // keep probing
            }
        }
    }

    private fun tryConnectUsbTunnel(usbPort: Int, token: String): UsbLink? {
        val s = Socket()
        return try {
            s.tcpNoDelay = true
            s.connect(InetSocketAddress("127.0.0.1", usbPort), 150)
            val out = s.getOutputStream()
            if (token.isNotEmpty()) {
                out.write(PairingAuth.streamLine(token, phoneName))
                out.flush()
            }
            val link = UsbLink(s, out)
            Thread({ readUsbFeedbackLoop(link) }, "Ds4UsbFeedback").apply {
                isDaemon = true
                start()
            }
            link
        } catch (_: Exception) {
            runCatching { s.close() }
            null
        }
    }

    private fun readUsbFeedbackLoop(link: UsbLink) {
        val buf = ByteArray(FEEDBACK_PACKET_SIZE)
        val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
        try {
            val input = link.socket.getInputStream()
            while (running.get() && !link.socket.isClosed) {
                var readTotal = 0
                while (readTotal < FEEDBACK_PACKET_SIZE) {
                    val n = input.read(buf, readTotal, FEEDBACK_PACKET_SIZE - readTotal)
                    if (n < 0) return
                    readTotal += n
                }
                handleFeedbackBytes(bb)
            }
        } catch (_: Exception) {
            // fall through: the link is dead
        } finally {
            usbLinkRef.compareAndSet(link, null) // sender falls back to Wi-Fi on its next frame
            runCatching { link.socket.close() }
        }
    }

    private fun listenWifiFeedback() {
        val buf = ByteArray(64)
        val pkt = DatagramPacket(buf, buf.size)
        val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
        while (running.get() && !Thread.currentThread().isInterrupted) {
            val sock = udpSocketRef.get()
            if (sock == null) {
                try { Thread.sleep(50) } catch (_: InterruptedException) { return }
                continue
            }
            try {
                pkt.length = buf.size
                sock.receive(pkt)
                if (pkt.length == FEEDBACK_PACKET_SIZE) handleFeedbackBytes(bb)
            } catch (_: SocketTimeoutException) {
                // idle
            } catch (_: InterruptedException) {
                return
            } catch (_: Exception) {
                try { Thread.sleep(50) } catch (_: InterruptedException) { return } // socket being replaced
            }
        }
    }

    /** 16-byte frame from the PC: either a rumble/echo frame or an RTT ping (echo seq 0xFFFFFFFF). */
    private fun handleFeedbackBytes(bb: ByteBuffer) {
        bb.rewind()
        val echoSeq = bb.int.toLong() and 0xFFFFFFFFL
        val echoTimestampUs = bb.long
        val b0 = bb.get().toInt() and 0xFF
        val b1 = bb.get().toInt() and 0xFF

        if (echoSeq == ControllerState.PING_SEQ) {
            // PC ping: bytes 14/15 hold the ping id; answer on the same transport with the PC timestamp
            val idLo = bb.get().toInt() and 0xFF
            val idHi = bb.get().toInt() and 0xFF
            pongTimestampUs = echoTimestampUs
            pongId = idLo or (idHi shl 8)
            pongPending.set(true)
            return
        }

        val nowUs = SystemClock.elapsedRealtimeNanos() / 1_000L
        val rttMs = (nowUs - echoTimestampUs) / 1000f
        lastFeedbackWallNs = SystemClock.elapsedRealtimeNanos()
        if (rttMs >= 0f && rttMs < 5_000f) { // reject nonsense; never invent a value
            latestRttMs = if (latestRttMs <= 0f) rttMs else (0.8f * latestRttMs + 0.2f * rttMs)
        }
        hapticsManager?.onPcRumblePacket(b0, b1)
    }
}
