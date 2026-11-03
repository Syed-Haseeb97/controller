package com.ds4bridge.controller

import android.content.Context
import org.json.JSONArray

data class PersistedAppSettings(
    val hostIp: String,
    val hostPort: Int,
    val pairingToken: String,
    val sendRateHz: Int,
    val autoUsbEnabled: Boolean,
    val gyroConfig: GyroConfig,
    val stickSettings: StickSettings,
    val rumbleEnabled: Boolean,
    val buttonHapticTapEnabled: Boolean,
    val profiles: List<ControllerLayoutProfile>,
    val activeProfileId: String
)

/**
 * Persistent storage backed by SharedPreferences for all user settings and custom/edited
 * layout profiles. Removes any hardcoded default IP (defaults to empty string `""`).
 */
object AppSettingsStore {
    private const val PREFS_FILE = "ds4_bridge_settings"

    private const val KEY_HOST_IP = "host_ip"
    private const val KEY_HOST_PORT = "host_port"
    private const val KEY_PAIRING_TOKEN = "pairing_token"
    private const val KEY_SEND_RATE_HZ = "send_rate_hz"
    private const val KEY_AUTO_USB = "auto_usb_enabled"

    private const val KEY_GYRO_ENABLED = "gyro_enabled"
    private const val KEY_GYRO_SENSITIVITY = "gyro_sensitivity"
    private const val KEY_GYRO_INVERT_X = "gyro_invert_x"
    private const val KEY_GYRO_INVERT_Y = "gyro_invert_y"
    private const val KEY_GYRO_DEADZONE = "gyro_deadzone"
    private const val KEY_GYRO_SMOOTHING = "gyro_smoothing"
    private const val KEY_GYRO_HOLD_GATE = "gyro_hold_gate"
    private const val KEY_GYRO_HOLD_MASK = "gyro_hold_mask_v2"

    private const val KEY_GYRO_SENS_Y = "gyro_sensitivity_y"
    private const val KEY_GYRO_GATE_TOGGLE = "gyro_gate_toggle"
    private const val KEY_GYRO_TO_LEFT = "gyro_to_left_stick"

    private const val KEY_RUMBLE_ENABLED = "rumble_enabled"
    private const val KEY_HAPTIC_TAP_ENABLED = "haptic_tap_enabled"

    private const val KEY_ACTIVE_PROFILE_ID = "active_profile_id"
    private const val KEY_PROFILES_JSON = "profiles_json"

    fun load(context: Context): PersistedAppSettings {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val defaultGyro = GyroConfig()
        val gyro = GyroConfig(
            enabled = prefs.getBoolean(KEY_GYRO_ENABLED, defaultGyro.enabled),
            sensitivity = prefs.getFloat(KEY_GYRO_SENSITIVITY, defaultGyro.sensitivity),
            invertX = prefs.getBoolean(KEY_GYRO_INVERT_X, defaultGyro.invertX),
            invertY = prefs.getBoolean(KEY_GYRO_INVERT_Y, defaultGyro.invertY),
            deadzoneRadPerSec = prefs.getFloat(KEY_GYRO_DEADZONE, defaultGyro.deadzoneRadPerSec),
            smoothingAlpha = prefs.getFloat(KEY_GYRO_SMOOTHING, defaultGyro.smoothingAlpha),
            requireHoldButton = prefs.getBoolean(KEY_GYRO_HOLD_GATE, defaultGyro.requireHoldButton),
            activationButtonMask = prefs.getInt(KEY_GYRO_HOLD_MASK, defaultGyro.activationButtonMask),
            sensitivityY = prefs.getFloat(KEY_GYRO_SENS_Y, defaultGyro.sensitivityY),
            gateToggle = prefs.getBoolean(KEY_GYRO_GATE_TOGGLE, defaultGyro.gateToggle),
            toLeftStick = prefs.getBoolean(KEY_GYRO_TO_LEFT, defaultGyro.toLeftStick)
        )

        val loadedProfiles = loadProfiles(prefs.getString(KEY_PROFILES_JSON, null))
        val savedActiveId = prefs.getString(KEY_ACTIVE_PROFILE_ID, null)
        val resolvedActiveId = if (loadedProfiles.any { it.id == savedActiveId }) {
            savedActiveId!!
        } else {
            loadedProfiles.first().id
        }

        return PersistedAppSettings(
            hostIp = prefs.getString(KEY_HOST_IP, "") ?: "",
            hostPort = prefs.getInt(KEY_HOST_PORT, 26760),
            pairingToken = prefs.getString(KEY_PAIRING_TOKEN, "") ?: "",
            sendRateHz = prefs.getInt(KEY_SEND_RATE_HZ, 120),
            autoUsbEnabled = prefs.getBoolean(KEY_AUTO_USB, true),
            gyroConfig = gyro,
            stickSettings = StickSettings(loadStick(prefs, "l"), loadStick(prefs, "r")),
            rumbleEnabled = prefs.getBoolean(KEY_RUMBLE_ENABLED, true),
            buttonHapticTapEnabled = prefs.getBoolean(KEY_HAPTIC_TAP_ENABLED, true),
            profiles = loadedProfiles,
            activeProfileId = resolvedActiveId
        )
    }

    fun saveEndpoint(
        context: Context,
        ip: String,
        port: Int,
        token: String,
        rateHz: Int,
        autoUsb: Boolean
    ) {
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_HOST_IP, ip.trim())
            .putInt(KEY_HOST_PORT, port)
            .putString(KEY_PAIRING_TOKEN, token.trim())
            .putInt(KEY_SEND_RATE_HZ, rateHz)
            .putBoolean(KEY_AUTO_USB, autoUsb)
            .apply()
    }

    fun saveGyroConfig(context: Context, cfg: GyroConfig) {
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_GYRO_ENABLED, cfg.enabled)
            .putFloat(KEY_GYRO_SENSITIVITY, cfg.sensitivity)
            .putBoolean(KEY_GYRO_INVERT_X, cfg.invertX)
            .putBoolean(KEY_GYRO_INVERT_Y, cfg.invertY)
            .putFloat(KEY_GYRO_DEADZONE, cfg.deadzoneRadPerSec)
            .putFloat(KEY_GYRO_SMOOTHING, cfg.smoothingAlpha)
            .putBoolean(KEY_GYRO_HOLD_GATE, cfg.requireHoldButton)
            .putInt(KEY_GYRO_HOLD_MASK, cfg.activationButtonMask)
            .putFloat(KEY_GYRO_SENS_Y, cfg.sensitivityY)
            .putBoolean(KEY_GYRO_GATE_TOGGLE, cfg.gateToggle)
            .putBoolean(KEY_GYRO_TO_LEFT, cfg.toLeftStick)
            .apply()
    }

    fun saveStickSettings(context: Context, settings: StickSettings) {
        val e = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
        putStick(e, "l", settings.left)
        putStick(e, "r", settings.right)
        e.apply()
    }

    private fun putStick(e: android.content.SharedPreferences.Editor, side: String, c: StickConfig) {
        e.putFloat("stick_${side}_deadzone", c.deadzone)
            .putFloat("stick_${side}_outer", c.outerZone)
            .putString("stick_${side}_curve", c.curve.name)
            .putFloat("stick_${side}_exp", c.exponent)
            .putBoolean("stick_${side}_invy", c.invertY)
    }

    private fun loadStick(prefs: android.content.SharedPreferences, side: String): StickConfig {
        val d = StickConfig()
        return StickConfig(
            deadzone = prefs.getFloat("stick_${side}_deadzone", d.deadzone),
            outerZone = prefs.getFloat("stick_${side}_outer", d.outerZone),
            curve = runCatching { StickCurve.valueOf(prefs.getString("stick_${side}_curve", d.curve.name)!!) }
                .getOrDefault(d.curve),
            exponent = prefs.getFloat("stick_${side}_exp", d.exponent),
            invertY = prefs.getBoolean("stick_${side}_invy", d.invertY)
        )
    }

    fun saveHaptics(context: Context, rumble: Boolean, tap: Boolean) {
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_RUMBLE_ENABLED, rumble)
            .putBoolean(KEY_HAPTIC_TAP_ENABLED, tap)
            .apply()
    }

    fun saveProfiles(
        context: Context,
        profiles: List<ControllerLayoutProfile>,
        activeProfileId: String
    ) {
        val arr = JSONArray()
        profiles.forEach { prof ->
            arr.put(org.json.JSONObject(prof.toJsonString(pretty = false)))
        }
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_PROFILES_JSON, arr.toString())
            .putString(KEY_ACTIVE_PROFILE_ID, activeProfileId)
            .apply()
    }

    private fun loadProfiles(rawJson: String?): List<ControllerLayoutProfile> {
        if (rawJson.isNullOrBlank()) return ControllerLayoutProfile.builtInPresets()
        return try {
            val arr = JSONArray(rawJson)
            val list = ArrayList<ControllerLayoutProfile>(arr.length())
            for (i in 0 until arr.length()) {
                // One corrupt profile must not wipe the others
                runCatching { ControllerLayoutProfile.fromJsonString(arr.getJSONObject(i).toString()) }
                    .onSuccess { list.add(it) }
            }
            if (list.isEmpty()) ControllerLayoutProfile.builtInPresets() else list
        } catch (_: Exception) {
            ControllerLayoutProfile.builtInPresets()
        }
    }
}
