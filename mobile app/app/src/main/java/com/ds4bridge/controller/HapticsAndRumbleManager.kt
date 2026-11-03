package com.ds4bridge.controller

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Handles both:
 *  1. Continuous DualShock 4 Force-Feedback / Rumble (`largeMotor` 0..255, `smallMotor` 0..255)
 *     streamed back from the PC ViGEmBus driver in real time.
 *  2. Optional crisp Haptic Tap feedback when pressing on-screen buttons.
 */
class HapticsAndRumbleManager(context: Context) {

    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vm?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    @Volatile var rumbleEnabled: Boolean = true
    @Volatile var buttonHapticTapEnabled: Boolean = true
    @Volatile var lastLargeMotor: Int = 0; private set
    @Volatile var lastSmallMotor: Int = 0; private set

    private var lastAppliedAmplitude: Int = 0
    private var lastVibrateAtMs: Long = 0L

    /**
     * Invoked when a 16-byte feedback packet (`<IQBBBB`) arrives from the PC receiver.
     * Blends heavy low-frequency (`largeMotor`) and light high-frequency (`smallMotor`)
     * intensities into an Android `VibrationEffect` amplitude (`1..255`).
     */
    fun onPcRumblePacket(largeMotor: Int, smallMotor: Int) {
        lastLargeMotor = largeMotor.coerceIn(0, 255)
        lastSmallMotor = smallMotor.coerceIn(0, 255)

        if (!rumbleEnabled) {
            stopRumble()
            return
        }

        // Weight heavy rotor (70%) + light rotor (30%), or take dominant peak
        val blended = max(
            lastLargeMotor,
            (lastLargeMotor * 0.7f + lastSmallMotor * 0.5f).roundToInt()
        ).coerceIn(0, 255)

        if (blended == 0) {
            if (lastAppliedAmplitude != 0) {
                stopRumble()
            }
            return
        }

        // One-shots last 120 ms, so a CONSTANT rumble must be re-triggered every ~90 ms or it would stop.
        // If the PC goes silent the last one-shot simply expires: rumble can never get stuck on.
        val now = SystemClock.elapsedRealtime()
        if (kotlin.math.abs(blended - lastAppliedAmplitude) >= 6 || (now - lastVibrateAtMs) >= 90L) {
            lastAppliedAmplitude = blended
            lastVibrateAtMs = now
            vibrator?.let { vib ->
                if (vib.hasVibrator()) {
                    vib.vibrate(VibrationEffect.createOneShot(120L, blended.coerceIn(1, 255)))
                }
            }
        }
    }

    fun stopRumble() {
        lastAppliedAmplitude = 0
        lastVibrateAtMs = 0L
        vibrator?.cancel()
    }

    /**
     * Plays a crisp 8ms tactile tick when an on-screen button transitions from unpressed -> pressed.
     */
    fun triggerButtonPressTap() {
        if (!buttonHapticTapEnabled) return
        vibrator?.let { vib ->
            if (!vib.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vib.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
            } else {
                vib.vibrate(VibrationEffect.createOneShot(8L, 90))
            }
        }
    }
}
