package com.ds4bridge.controller

import kotlin.math.hypot
import kotlin.math.pow

enum class StickCurve { LINEAR, QUADRATIC, CUSTOM }

/**
 * Per-stick response shaping.
 *  - [deadzone]  : radial inner deadzone, fraction of full travel (0..0.5)
 *  - [outerZone] : fraction of travel at which output already reaches 100 % (0.6..1.0); anything
 *                  beyond is clamped, so a thumb that cannot reach the rim still gets full deflection
 *  - [curve]     : LINEAR, QUADRATIC (x^2) or CUSTOM (x^[exponent]) applied to the rescaled magnitude
 *  - [invertY]   : flips the vertical axis
 */
data class StickConfig(
    val deadzone: Float = 0.08f,
    val outerZone: Float = 1.0f,
    val curve: StickCurve = StickCurve.LINEAR,
    val exponent: Float = 1.5f,
    val invertY: Boolean = false
)

data class StickSettings(
    val left: StickConfig = StickConfig(),
    val right: StickConfig = StickConfig()
)

object StickMath {
    /**
     * Shapes a raw normalized stick vector ([-1..1] each, already clamped to the unit circle)
     * and writes the result into [out] (`out[0]` = x, `out[1]` = y). Allocation-free.
     */
    fun shape(x: Float, y: Float, cfg: StickConfig, out: FloatArray) {
        val dz = cfg.deadzone.coerceIn(0f, 0.5f)
        val outer = cfg.outerZone.coerceIn(dz + 0.05f, 1f)
        val mag = hypot(x, y)
        var ox = 0f
        var oy = 0f
        if (mag > dz && mag > 0f) {
            val scaled = ((mag - dz) / (outer - dz)).coerceIn(0f, 1f)
            val curved = when (cfg.curve) {
                StickCurve.LINEAR -> scaled
                StickCurve.QUADRATIC -> scaled * scaled
                StickCurve.CUSTOM -> scaled.pow(cfg.exponent.coerceIn(0.3f, 4f))
            }
            ox = x / mag * curved
            oy = y / mag * curved
        }
        out[0] = ox
        out[1] = if (cfg.invertY) -oy else oy
    }
}
