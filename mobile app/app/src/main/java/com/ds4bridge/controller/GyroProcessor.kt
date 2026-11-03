package com.ds4bridge.controller

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.hypot

/**
 * User-adjustable gyroscope-to-right-stick configuration.
 */
data class GyroConfig(
    val enabled: Boolean = true,
    val sensitivity: Float = 1.6f,             // X (yaw) multiplier mapping rad/s -> normalized stick [-1..1]
    val sensitivityY: Float = 1.6f,            // Y (pitch) multiplier; the UI keeps it equal to X while "link X/Y" is on
    val invertX: Boolean = false,              // Invert yaw -> RX
    val invertY: Boolean = false,              // Invert pitch -> RY
    val deadzoneRadPerSec: Float = 0.025f,     // Ignore micro-tremors below threshold (rad/s)
    val smoothingAlpha: Float = 0.35f,         // 0.0 = raw, 0.90 = heavy EMA low-pass filter
    val requireHoldButton: Boolean = true,     // "Gyro active while button X is held"
    val activationButtonMask: Int = ControllerState.BTN_L2_DIG, // Default: hold L2 (ADS) or Cross
    val gateToggle: Boolean = false,           // false = active while held, true = press once to toggle on/off
    val toLeftStick: Boolean = false           // true = gyro drives the LEFT stick instead of the right
)

data class GyroCalibrationState(
    val isCalibrating: Boolean = false,
    val progress: Float = 0f,
    val biasX: Float = 0f,
    val biasY: Float = 0f,
    val biasZ: Float = 0f,
    val rmsNoise: Float = 0f
)

/**
 * Reads the hardware Gyroscope & Accelerometer at `SENSOR_DELAY_FASTEST` on its own dedicated
 * high-priority `HandlerThread` so UI recomposition never delays sensor sampling.
 */
class GyroProcessor(
    context: Context,
    private val configRef: AtomicReference<GyroConfig>,
    private val onCalibrationUpdated: (GyroCalibrationState) -> Unit,
    /** Called (sensor thread) when the phone lies still but the gyro still reports a constant rate. */
    private val onDriftDetected: ((Float) -> Unit)? = null
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val gyroSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE_UNCALIBRATED)
        ?: sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val accelSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private var sensorThread: HandlerThread? = null
    private var sensorHandler: Handler? = null

    // Calibrated stationary drift offsets (rad/s)
    @Volatile var biasX = 0f; private set
    @Volatile var biasY = 0f; private set
    @Volatile var biasZ = 0f; private set

    // Latest filtered gyro & accel values read by the 120Hz state combiner
    @Volatile var filteredGyroX = 0f; private set
    @Volatile var filteredGyroY = 0f; private set
    @Volatile var filteredGyroZ = 0f; private set
    @Volatile var latestAccelX = 0f; private set
    @Volatile var latestAccelY = 0f; private set
    @Volatile var latestAccelZ = 9.81f; private set

    // Calibration accumulator (collects 240 samples while phone rests still)
    @Volatile private var calibrating = false
    private val targetSamples = 240
    private var sampleCount = 0
    private var sumX = 0.0
    private var sumY = 0.0
    private var sumZ = 0.0
    private var sumSq = 0.0

    // Idle drift detection: accelerometer says "not moving" for 5 s but gyro mean stays above noise
    private var lastAx = 0f
    private var lastAy = 0f
    private var lastAz = 0f
    @Volatile private var stillSinceNs = 0L
    private var driftSumX = 0.0
    private var driftSumY = 0.0
    private var driftSumZ = 0.0
    private var driftN = 0
    private var lastDriftPromptNs = 0L

    // Gate state for toggle mode (touched only by the 120 Hz sender thread)
    private var gateOn = false
    private var prevGateDown = false

    fun start() {
        if (sensorThread != null) return
        filteredGyroX = 0f; filteredGyroY = 0f; filteredGyroZ = 0f
        stillSinceNs = 0L
        val thread = HandlerThread("Ds4GyroSensorThread", Process.THREAD_PRIORITY_URGENT_AUDIO).apply {
            start()
        }
        val handler = Handler(thread.looper)
        sensorThread = thread
        sensorHandler = handler

        gyroSensor?.let {
            // SENSOR_DELAY_FASTEST above 200 Hz needs HIGH_SAMPLING_RATE_SENSORS (declared in the manifest,
            // a normal permission). Fall back to GAME rate if the platform still refuses.
            val ok = try {
                sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST, handler)
            } catch (_: SecurityException) {
                false
            }
            if (!ok) sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, handler)
        }
        accelSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, handler)
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        sensorThread?.quitSafely()
        sensorThread = null
        sensorHandler = null
        calibrating = false
        filteredGyroX = 0f; filteredGyroY = 0f; filteredGyroZ = 0f
    }

    /**
     * Triggers stationary drift calibration on the sensor thread.
     */
    fun startCalibration() {
        sampleCount = 0
        sumX = 0.0
        sumY = 0.0
        sumZ = 0.0
        sumSq = 0.0
        calibrating = true
        onCalibrationUpdated(
            GyroCalibrationState(isCalibrating = true, progress = 0f, biasX = biasX, biasY = biasY, biasZ = biasZ)
        )
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GYROSCOPE, Sensor.TYPE_GYROSCOPE_UNCALIBRATED -> {
                val rawX = event.values[0]
                val rawY = event.values[1]
                val rawZ = event.values[2]

                if (calibrating) {
                    sumX += rawX
                    sumY += rawY
                    sumZ += rawZ
                    sumSq += (rawX * rawX + rawY * rawY + rawZ * rawZ)
                    sampleCount++

                    if (sampleCount >= targetSamples) {
                        biasX = (sumX / targetSamples).toFloat()
                        biasY = (sumY / targetSamples).toFloat()
                        biasZ = (sumZ / targetSamples).toFloat()
                        val rms = kotlin.math.sqrt(sumSq / (targetSamples * 3.0)).toFloat()
                        calibrating = false
                        onCalibrationUpdated(
                            GyroCalibrationState(
                                isCalibrating = false,
                                progress = 1f,
                                biasX = biasX,
                                biasY = biasY,
                                biasZ = biasZ,
                                rmsNoise = rms
                            )
                        )
                    } else if (sampleCount % 12 == 0) {
                        onCalibrationUpdated(
                            GyroCalibrationState(
                                isCalibrating = true,
                                progress = sampleCount.toFloat() / targetSamples,
                                biasX = biasX,
                                biasY = biasY,
                                biasZ = biasZ
                            )
                        )
                    }
                    return
                }

                // 1. Subtract calibrated stationary drift
                val calX = rawX - biasX
                val calY = rawY - biasY
                val calZ = rawZ - biasZ

                // 2. Apply EMA smoothing filter controlled by user slider
                val cfg = configRef.get()
                val alpha = cfg.smoothingAlpha.coerceIn(0f, 0.95f)
                val oneMinusAlpha = 1f - alpha
                filteredGyroX = alpha * filteredGyroX + oneMinusAlpha * calX
                filteredGyroY = alpha * filteredGyroY + oneMinusAlpha * calY
                filteredGyroZ = alpha * filteredGyroZ + oneMinusAlpha * calZ

                // 3. Idle drift watch (only while the accelerometer reports the phone as still)
                val since = stillSinceNs
                if (since != 0L) {
                    driftSumX += calX; driftSumY += calY; driftSumZ += calZ; driftN++
                    val nowNs = SystemClock.elapsedRealtimeNanos()
                    if (nowNs - since > 5_000_000_000L && driftN > 200) {
                        val mx = driftSumX / driftN
                        val my = driftSumY / driftN
                        val mz = driftSumZ / driftN
                        val meanMag = kotlin.math.sqrt(mx * mx + my * my + mz * mz).toFloat()
                        driftSumX = 0.0; driftSumY = 0.0; driftSumZ = 0.0; driftN = 0
                        stillSinceNs = nowNs
                        if (meanMag > 0.012f && (nowNs - lastDriftPromptNs) > 60_000_000_000L) {
                            lastDriftPromptNs = nowNs
                            onDriftDetected?.invoke(meanMag)
                        }
                    }
                }
            }

            Sensor.TYPE_ACCELEROMETER -> {
                val dMag = abs(event.values[0] - lastAx) + abs(event.values[1] - lastAy) + abs(event.values[2] - lastAz)
                lastAx = event.values[0]; lastAy = event.values[1]; lastAz = event.values[2]
                if (dMag < 0.06f) {
                    if (stillSinceNs == 0L) {
                        stillSinceNs = SystemClock.elapsedRealtimeNanos()
                        driftSumX = 0.0; driftSumY = 0.0; driftSumZ = 0.0; driftN = 0
                    }
                } else {
                    stillSinceNs = 0L
                }
                latestAccelX = event.values[0]
                latestAccelY = event.values[1]
                latestAccelZ = event.values[2]
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    /**
     * Pure rate -> normalized stick mapping (deadzone, separate X/Y sensitivity, inversion).
     * Allocation-free: writes `out[0]` (X) and `out[1]` (Y), both in -1..1.
     *
     * In landscape: yaw (turning the phone) -> X, pitch (tilting up/down) -> Y.
     */
    private fun rawOffsetInto(cfg: GyroConfig, out: FloatArray) {
        var yawRate = -filteredGyroZ
        var pitchRate = filteredGyroX
        val mag = hypot(yawRate, pitchRate)
        if (mag < cfg.deadzoneRadPerSec) {
            out[0] = 0f; out[1] = 0f
            return
        }
        val rescale = (mag - cfg.deadzoneRadPerSec) / mag
        yawRate *= rescale
        pitchRate *= rescale
        if (cfg.invertX) yawRate = -yawRate
        if (cfg.invertY) pitchRate = -pitchRate
        out[0] = (yawRate * cfg.sensitivity * 0.25f).coerceIn(-1f, 1f)
        out[1] = (pitchRate * cfg.sensitivityY * 0.25f).coerceIn(-1f, 1f)
    }

    /**
     * 120 Hz hot path (sender thread only): applies the hold/toggle gate, then writes the gyro stick
     * offset into [out]. No allocation. The target stick (right or left) is chosen by the caller
     * via [GyroConfig.toLeftStick].
     */
    fun computeInto(currentButtonsMask: Int, out: FloatArray) {
        val cfg = configRef.get()
        if (!cfg.enabled) {
            out[0] = 0f; out[1] = 0f
            return
        }
        if (cfg.requireHoldButton) {
            val down = (currentButtonsMask and cfg.activationButtonMask) != 0
            val active = if (cfg.gateToggle) {
                if (down && !prevGateDown) gateOn = !gateOn
                gateOn
            } else {
                gateOn = false
                down
            }
            prevGateDown = down
            if (!active) {
                out[0] = 0f; out[1] = 0f
                return
            }
        }
        rawOffsetInto(cfg, out)
    }

    /** True when the gyro offset should drive the left stick instead of the right one. */
    fun targetsLeftStick(): Boolean = configRef.get().toLeftStick

    /** UI preview (live dot): ignores the gate so the user can see the raw tilt. Allocates; UI only. */
    fun peekOffset(): Pair<Float, Float> {
        val cfg = configRef.get()
        if (!cfg.enabled) return 0f to 0f
        val tmp = FloatArray(2)
        rawOffsetInto(cfg, tmp)
        return tmp[0] to tmp[1]
    }
}
