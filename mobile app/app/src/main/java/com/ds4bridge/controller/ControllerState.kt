package com.ds4bridge.controller

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Single immutable data class representing the complete DualShock 4 state.
 * Serializes directly to the 48-byte little-endian binary packet `<IQHhhhhBBffffff`
 * expected by the Windows Python `ds4_udp_receiver.py` ViGEmBus driver.
 */
data class ControllerState(
    val buttonsMask: Int = 0,          // bits 0..15 go on the wire; bits 16+ are app-only (L2/R2 holds)
    val lx: Short = 0,                 // Left stick X  (-32768..32767)
    val ly: Short = 0,                 // Left stick Y  (-32768..32767)
    val rx: Short = 0,                 // Right stick X (-32768..32767, includes gyro delta if active)
    val ry: Short = 0,                 // Right stick Y (-32768..32767, includes gyro delta if active)
    val l2: Int = 0,                   // Left trigger  (0..255 uint8)
    val r2: Int = 0,                   // Right trigger (0..255 uint8)
    val gyroX: Float = 0f,             // Calibrated gyro X (rad/s)
    val gyroY: Float = 0f,             // Calibrated gyro Y (rad/s)
    val gyroZ: Float = 0f,             // Calibrated gyro Z (rad/s)
    val accelX: Float = 0f,            // Accelerometer X (m/s^2)
    val accelY: Float = 0f,            // Accelerometer Y (m/s^2)
    val accelZ: Float = 9.81f          // Accelerometer Z (m/s^2)
) {
    companion object {
        const val PACKET_SIZE_BYTES = 48

        // 16-bit Button Bitmask Definitions (matches Python receiver exactly)
        const val BTN_CROSS      = 1 shl 0   // 0x0001
        const val BTN_CIRCLE     = 1 shl 1   // 0x0002
        const val BTN_SQUARE     = 1 shl 2   // 0x0004
        const val BTN_TRIANGLE   = 1 shl 3   // 0x0008
        const val BTN_L1         = 1 shl 4   // 0x0010
        const val BTN_R1         = 1 shl 5   // 0x0020
        const val BTN_PS         = 1 shl 6   // 0x0040 (DS4 special button: PS / Home)
        const val BTN_TOUCHPAD   = 1 shl 7   // 0x0080 (DS4 special button: touchpad click)
        const val BTN_SHARE      = 1 shl 8   // 0x0100 (Select)
        const val BTN_OPTIONS    = 1 shl 9   // 0x0200 (Start)
        const val BTN_L3         = 1 shl 10  // 0x0400
        const val BTN_R3         = 1 shl 11  // 0x0800
        const val BTN_DPAD_UP    = 1 shl 12  // 0x1000
        const val BTN_DPAD_DOWN  = 1 shl 13  // 0x2000
        const val BTN_DPAD_LEFT  = 1 shl 14  // 0x4000
        const val BTN_DPAD_RIGHT = 1 shl 15  // 0x8000

        // APP-ONLY flags (bits 16/17). L2/R2 have NO digital bit on the wire: the PC derives
        // them from the analog l2/r2 bytes. The UI still uses these to track a held trigger and
        // for the gyro activation gate; writeToBuffer() masks them off with `and 0xFFFF`.
        const val BTN_L2_DIG     = 1 shl 16
        const val BTN_R2_DIG     = 1 shl 17
        const val WIRE_BUTTON_MASK = 0xFFFF

        /** Sentinel sequence used ONLY by RTT ping (PC->phone, 16 B) and pong (phone->PC, 48 B) frames. */
        const val PING_SEQ = 0xFFFFFFFFL

        /**
         * Single serializer for the exact 48-byte little-endian layout `<IQHhhhhBBffffff`.
         * Allocation-free: used by both [ControllerState] and [MutableControllerState].
         */
        fun writePacket(
            buffer: ByteBuffer, seq: Long, timestampUs: Long, buttonsMask: Int,
            lx: Short, ly: Short, rx: Short, ry: Short, l2: Int, r2: Int,
            gyroX: Float, gyroY: Float, gyroZ: Float, accelX: Float, accelY: Float, accelZ: Float
        ) {
            buffer.clear()
            buffer.order(ByteOrder.LITTLE_ENDIAN)
            buffer.putInt((seq and 0xFFFFFFFFL).toInt())
            buffer.putLong(timestampUs)
            buffer.putShort((buttonsMask and WIRE_BUTTON_MASK).toShort()) // app-only L2/R2 flags dropped
            buffer.putShort(lx)
            buffer.putShort(ly)
            buffer.putShort(rx)
            buffer.putShort(ry)
            buffer.put(l2.coerceIn(0, 255).toByte())
            buffer.put(r2.coerceIn(0, 255).toByte())
            buffer.putFloat(gyroX)
            buffer.putFloat(gyroY)
            buffer.putFloat(gyroZ)
            buffer.putFloat(accelX)
            buffer.putFloat(accelY)
            buffer.putFloat(accelZ)
            buffer.flip()
        }

        fun floatAxisToInt16(norm: Float): Short {
            val clamped = norm.coerceIn(-1f, 1f)
            return (clamped * 32767f).roundToInt().coerceIn(-32768, 32767).toShort()
        }
    }

    /**
     * Writes the 48-byte binary representation into a pre-allocated Little-Endian ByteBuffer
     * to guarantee zero GC allocations on the 120Hz UDP sender thread.
     *
     * Layout `<IQHhhhhBBffffff`:
     *  [0..3]   uint32  seq
     *  [4..11]  uint64  timestamp_us
     *  [12..13] uint16  buttons
     *  [14..15] int16   lx
     *  [16..17] int16   ly
     *  [18..19] int16   rx
     *  [20..21] int16   ry
     *  [22]     uint8   l2
     *  [23]     uint8   r2
     *  [24..35] float32 gyro_x, gyro_y, gyro_z
     *  [36..47] float32 accel_x, accel_y, accel_z
     */
    fun writeToBuffer(buffer: ByteBuffer, seq: Long, timestampUs: Long) {
        writePacket(
            buffer, seq, timestampUs, buttonsMask, lx, ly, rx, ry, l2, r2,
            gyroX, gyroY, gyroZ, accelX, accelY, accelZ
        )
    }
}

/**
 * Reusable, mutable frame owned by the 120 Hz sender thread. The thread fills it every frame and
 * serializes it, so the hot path allocates nothing (no `copy()`, no `Pair`).
 */
class MutableControllerState {
    @JvmField var buttonsMask: Int = 0
    @JvmField var lx: Short = 0
    @JvmField var ly: Short = 0
    @JvmField var rx: Short = 0
    @JvmField var ry: Short = 0
    @JvmField var l2: Int = 0
    @JvmField var r2: Int = 0
    @JvmField var gyroX: Float = 0f
    @JvmField var gyroY: Float = 0f
    @JvmField var gyroZ: Float = 0f
    @JvmField var accelX: Float = 0f
    @JvmField var accelY: Float = 0f
    @JvmField var accelZ: Float = 9.81f

    fun setNeutral() {
        buttonsMask = 0; lx = 0; ly = 0; rx = 0; ry = 0; l2 = 0; r2 = 0
    }

    fun writeToBuffer(buffer: ByteBuffer, seq: Long, timestampUs: Long) {
        ControllerState.writePacket(
            buffer, seq, timestampUs, buttonsMask, lx, ly, rx, ry, l2, r2,
            gyroX, gyroY, gyroZ, accelX, accelY, accelZ
        )
    }
}

/**
 * Lock-free touch snapshot written by the Compose pointer handler and read by the sender thread.
 * Plain volatile primitives: no allocation per touch event, no Compose state read on the hot path.
 * (Fields are written individually; a one-frame tear between axes is harmless at 120 Hz.)
 */
class TouchInput {
    @Volatile @JvmField var buttonsMask: Int = 0
    @Volatile @JvmField var lx: Short = 0
    @Volatile @JvmField var ly: Short = 0
    @Volatile @JvmField var rx: Short = 0
    @Volatile @JvmField var ry: Short = 0
    @Volatile @JvmField var l2: Int = 0
    @Volatile @JvmField var r2: Int = 0

    fun setNeutral() {
        buttonsMask = 0; lx = 0; ly = 0; rx = 0; ry = 0; l2 = 0; r2 = 0
    }
}
