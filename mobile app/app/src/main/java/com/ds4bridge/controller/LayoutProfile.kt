package com.ds4bridge.controller

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/**
 * Single global toggle controlling whether Android image controls display a visible outline
 * and short label over transparent placeholder PNGs in `res/drawable-xxhdpi/`.
 * Set to `false` once final opaque PNG/WebP artwork is dropped into `res/drawable-xxhdpi/`.
 */
const val USE_PLACEHOLDER_LABELS: Boolean = false

@Composable
fun DrawableWithFallback(
    @DrawableRes resId: Int,
    fallbackLabel: String,
    modifier: Modifier = Modifier,
    isCircular: Boolean = false,
    /** Optional accent tint (ColorFilter) applied to white icon artwork, e.g. while pressed. */
    tint: Color? = null
) {
    val shape = if (isCircular) CircleShape else RoundedCornerShape(10.dp)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.then(
            if (USE_PLACEHOLDER_LABELS) {
                Modifier
                    .background(Color(0xB30D1226), shape)
                    .border(1.5.dp, Color(0xCC475569), shape)
            } else {
                Modifier
            }
        )
    ) {
        Image(
            painter = painterResource(id = resId),
            contentDescription = fallbackLabel,
            contentScale = ContentScale.Fit,
            colorFilter = if (tint != null) ColorFilter.tint(tint) else null,
            modifier = Modifier.fillMaxSize()
        )
        if (USE_PLACEHOLDER_LABELS) {
            Text(
                text = fallbackLabel,
                color = Color(0xFFE2E8F0),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
                maxLines = 1
            )
        }
    }
}

/**
 * Represents any assignable DualShock 4 target (16 digital buttons or analog stick/trigger axes)
 * that an image-based on-screen control can be mapped to in Edit Mode.
 */
enum class Ds4ControlTarget(
    val displayName: String,
    val isAxis: Boolean,
    val buttonMask: Int = 0,
    @DrawableRes val defaultDrawableRes: Int
) {
    LEFT_STICK("Left Analog Stick", true, 0, R.drawable.stick_base),
    RIGHT_STICK("Right Analog Stick", true, 0, R.drawable.stick_base),
    L2_TRIGGER("L2 Trigger", false, ControllerState.BTN_L2_DIG, R.drawable.btn_l2),
    R2_TRIGGER("R2 Trigger", false, ControllerState.BTN_R2_DIG, R.drawable.btn_r2),
    BTN_CROSS("Cross", false, ControllerState.BTN_CROSS, R.drawable.btn_cross),
    BTN_CIRCLE("Circle", false, ControllerState.BTN_CIRCLE, R.drawable.btn_circle),
    BTN_SQUARE("Square", false, ControllerState.BTN_SQUARE, R.drawable.btn_square),
    BTN_TRIANGLE("Triangle", false, ControllerState.BTN_TRIANGLE, R.drawable.btn_triangle),
    BTN_L1("L1 Shoulder", false, ControllerState.BTN_L1, R.drawable.btn_l1),
    BTN_R1("R1 Shoulder", false, ControllerState.BTN_R1, R.drawable.btn_r1),
    BTN_L3("L3 Thumb", false, ControllerState.BTN_L3, R.drawable.btn_l3),
    BTN_R3("R3 Thumb", false, ControllerState.BTN_R3, R.drawable.btn_r3),
    BTN_SHARE("Share", false, ControllerState.BTN_SHARE, R.drawable.btn_share),
    BTN_OPTIONS("Options", false, ControllerState.BTN_OPTIONS, R.drawable.btn_options),
    BTN_PS("PS Button", false, ControllerState.BTN_PS, R.drawable.btn_ps),
    BTN_TOUCHPAD("Touchpad Click", false, ControllerState.BTN_TOUCHPAD, R.drawable.btn_touchpad),
    DPAD_UP("D-Pad Up", false, ControllerState.BTN_DPAD_UP, R.drawable.dpad_up),
    DPAD_DOWN("D-Pad Down", false, ControllerState.BTN_DPAD_DOWN, R.drawable.dpad_down),
    DPAD_LEFT("D-Pad Left", false, ControllerState.BTN_DPAD_LEFT, R.drawable.dpad_left),
    DPAD_RIGHT("D-Pad Right", false, ControllerState.BTN_DPAD_RIGHT, R.drawable.dpad_right);
}

/** Face buttons ship in their own colours; every other icon is white artwork that is tinted on press. */
val Ds4ControlTarget.tintsOnPress: Boolean
    get() = this != Ds4ControlTarget.BTN_CROSS && this != Ds4ControlTarget.BTN_CIRCLE &&
        this != Ds4ControlTarget.BTN_SQUARE && this != Ds4ControlTarget.BTN_TRIANGLE

/** Default on-screen size (dp) of a control before the per-element scale is applied. */
fun Ds4ControlTarget.baseSizeDp(): Pair<Float, Float> = when (this) {
    Ds4ControlTarget.BTN_L1, Ds4ControlTarget.BTN_R1,
    Ds4ControlTarget.L2_TRIGGER, Ds4ControlTarget.R2_TRIGGER -> 90f to 48f
    Ds4ControlTarget.BTN_TOUCHPAD -> 144f to 62f
    Ds4ControlTarget.BTN_SHARE, Ds4ControlTarget.BTN_OPTIONS,
    Ds4ControlTarget.BTN_L3, Ds4ControlTarget.BTN_R3 -> 56f to 36f
    else -> 58f to 58f
}

val Ds4ControlTarget.isTrigger: Boolean
    get() = this == Ds4ControlTarget.L2_TRIGGER || this == Ds4ControlTarget.R2_TRIGGER

/**
 * Configurable layout state for a single draggable/resizable control in Edit Mode.
 * [target] is the DS4 input this control produces and also decides which artwork is drawn,
 * so remapping a control to any DS4 input (incl. stick clicks, PS, touchpad, D-pad) is one field.
 */
data class ControlElementLayout(
    val id: String,
    val label: String,
    val normX: Float,                  // 0.0 .. 1.0 screen width fraction
    val normY: Float,                  // 0.0 .. 1.0 screen height fraction
    val scale: Float = 1.0f,           // 0.5x .. 2.0x size multiplier
    val opacity: Float = 0.90f,        // 0.15 .. 1.0 alpha
    val target: Ds4ControlTarget,
    val visible: Boolean = true        // hidden controls are neither drawn nor hit-tested
) {
    @DrawableRes
    fun resolveDrawableRes(): Int = target.defaultDrawableRes

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("label", label)
        put("normX", normX.toDouble())
        put("normY", normY.toDouble())
        put("scale", scale.toDouble())
        put("opacity", opacity.toDouble())
        put("target", target.name)
        put("visible", visible)
    }
}

/** Result of validating imported profile JSON. */
sealed class ProfileParseResult {
    data class Ok(val profile: ControllerLayoutProfile, val warnings: List<String>) : ProfileParseResult()
    data class Error(val message: String) : ProfileParseResult()
}

/**
 * Schema validation for profile JSON (mirrored by `src/protocol/profileSchema.ts`).
 * Rules: object with non-empty `elements` (max 64); each element needs unique string `id`, numeric
 * `normX`/`normY` in 0..1 and a valid `target` name; `scale`/`opacity` are clamped with a warning;
 * `schema` newer than [VERSION] is rejected. Errors say exactly what is wrong and where.
 */
object ProfileSchema {
    const val VERSION = 1
    const val MAX_ELEMENTS = 64

    fun parse(raw: String): ProfileParseResult {
        if (raw.isBlank()) return ProfileParseResult.Error("Nothing to import: the text is empty.")
        val root = try {
            JSONObject(raw.trim())
        } catch (e: Exception) {
            return ProfileParseResult.Error("Not valid JSON (${e.message?.take(80) ?: "parse error"}). Paste the full profile text exported from this app.")
        }
        val schema = root.optInt("schema", VERSION)
        if (schema > VERSION) {
            return ProfileParseResult.Error("Profile schema v$schema is newer than this app understands (v$VERSION). Update the app.")
        }
        val arr = root.optJSONArray("elements")
            ?: return ProfileParseResult.Error("Missing \"elements\" array. A profile needs a list of on-screen controls.")
        if (arr.length() == 0) return ProfileParseResult.Error("\"elements\" is empty. Add at least one control.")
        if (arr.length() > MAX_ELEMENTS) {
            return ProfileParseResult.Error("Too many controls (${arr.length()}). Maximum is $MAX_ELEMENTS.")
        }

        val warnings = ArrayList<String>()
        val seen = HashSet<String>()
        val list = ArrayList<ControlElementLayout>(arr.length())
        val validTargets = Ds4ControlTarget.values().joinToString(", ") { it.name }
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i)
                ?: return ProfileParseResult.Error("elements[$i] is not an object.")
            val id = o.optString("id", "").trim()
            if (id.isEmpty()) return ProfileParseResult.Error("elements[$i] has no \"id\".")
            if (!seen.add(id)) return ProfileParseResult.Error("Duplicate control id \"$id\" (elements[$i]).")
            val nx = o.opt("normX")
            val ny = o.opt("normY")
            if (nx !is Number || ny !is Number) {
                return ProfileParseResult.Error("Control \"$id\": normX and normY must be numbers between 0 and 1.")
            }
            val targetName = o.optString("target", "")
            val target = Ds4ControlTarget.values().firstOrNull { it.name == targetName }
                ?: return ProfileParseResult.Error("Control \"$id\": unknown target \"$targetName\". Valid targets: $validTargets.")
            val x = nx.toFloat()
            val y = ny.toFloat()
            if (x !in 0f..1f || y !in 0f..1f) warnings.add("Control \"$id\" was outside the screen and was moved back in.")
            val scale = o.optDouble("scale", 1.0).toFloat()
            val opacity = o.optDouble("opacity", 0.9).toFloat()
            if (scale !in 0.5f..2.0f) warnings.add("Control \"$id\" size was clamped to 0.5x-2.0x.")
            if (opacity !in 0.15f..1.0f) warnings.add("Control \"$id\" opacity was clamped to 15%-100%.")
            list.add(
                ControlElementLayout(
                    id = id,
                    label = o.optString("label", id).take(24),
                    normX = x.coerceIn(0.02f, 0.98f),
                    normY = y.coerceIn(0.04f, 0.96f),
                    scale = scale.coerceIn(0.5f, 2.0f),
                    opacity = opacity.coerceIn(0.15f, 1.0f),
                    target = target,
                    visible = o.optBoolean("visible", true)
                )
            )
        }
        val profile = ControllerLayoutProfile(
            id = root.optString("id", "").ifBlank { "custom_${System.currentTimeMillis()}" },
            name = root.optString("name", "Imported Profile").ifBlank { "Imported Profile" }.take(40),
            elements = list,
            leftStickFloating = root.optBoolean("leftStickFloating", false)
        )
        return ProfileParseResult.Ok(profile, warnings)
    }
}

/**
 * Complete named controller layout profile ("Default DS4", "FPS", "Racing", or custom user JSON).
 * [leftStickFloating]: the left stick appears wherever the thumb lands (left half of the screen)
 * instead of sitting at a fixed spot; chosen per profile.
 */
data class ControllerLayoutProfile(
    val id: String,
    val name: String,
    val elements: List<ControlElementLayout>,
    val leftStickFloating: Boolean = false
) {
    fun toJsonString(pretty: Boolean = true): String {
        val root = JSONObject().apply {
            put("schema", ProfileSchema.VERSION)
            put("id", id)
            put("name", name)
            put("leftStickFloating", leftStickFloating)
            val arr = JSONArray()
            elements.forEach { arr.put(it.toJson()) }
            put("elements", arr)
        }
        return if (pretty) root.toString(2) else root.toString()
    }

    /** True for the three built-in presets (they can be reset, not deleted). */
    val isBuiltIn: Boolean get() = id == "default_ds4" || id == "fps_pro" || id == "racing_sim"

    companion object {
        /** Throws [IllegalArgumentException] with the schema error message on invalid input. */
        fun fromJsonString(json: String): ControllerLayoutProfile =
            when (val r = ProfileSchema.parse(json)) {
                is ProfileParseResult.Ok -> r.profile
                is ProfileParseResult.Error -> throw IllegalArgumentException(r.message)
            }

        fun builtInPresets(): List<ControllerLayoutProfile> = listOf(
            defaultDs4Profile(),
            fpsProfile(),
            racingProfile()
        )

        /** Factory layout for [profile] (built-in preset by id, otherwise the default DS4 layout). */
        fun factoryElementsFor(profileId: String): List<ControlElementLayout> =
            builtInPresets().firstOrNull { it.id == profileId }?.elements ?: defaultDs4Profile().elements

        fun duplicateOf(source: ControllerLayoutProfile): ControllerLayoutProfile =
            source.copy(id = "custom_${System.currentTimeMillis()}", name = "${source.name} copy".take(40))

        fun defaultDs4Profile() = ControllerLayoutProfile(
            id = "default_ds4",
            name = "Default DS4",
            elements = listOf(
                ControlElementLayout("l2", "L2", 0.08f, 0.12f, 1.0f, 0.9f, Ds4ControlTarget.L2_TRIGGER),
                ControlElementLayout("l1", "L1", 0.20f, 0.12f, 1.0f, 0.9f, Ds4ControlTarget.BTN_L1),
                ControlElementLayout("r1", "R1", 0.80f, 0.12f, 1.0f, 0.9f, Ds4ControlTarget.BTN_R1),
                ControlElementLayout("r2", "R2", 0.92f, 0.12f, 1.0f, 0.9f, Ds4ControlTarget.R2_TRIGGER),
                ControlElementLayout("dpad_up", "Up", 0.14f, 0.36f, 1.0f, 0.9f, Ds4ControlTarget.DPAD_UP),
                ControlElementLayout("dpad_down", "Down", 0.14f, 0.60f, 1.0f, 0.9f, Ds4ControlTarget.DPAD_DOWN),
                ControlElementLayout("dpad_left", "Left", 0.07f, 0.48f, 1.0f, 0.9f, Ds4ControlTarget.DPAD_LEFT),
                ControlElementLayout("dpad_right", "Right", 0.21f, 0.48f, 1.0f, 0.9f, Ds4ControlTarget.DPAD_RIGHT),
                ControlElementLayout("triangle", "Triangle", 0.86f, 0.36f, 1.0f, 0.9f, Ds4ControlTarget.BTN_TRIANGLE),
                ControlElementLayout("cross", "Cross", 0.86f, 0.60f, 1.0f, 0.9f, Ds4ControlTarget.BTN_CROSS),
                ControlElementLayout("square", "Square", 0.79f, 0.48f, 1.0f, 0.9f, Ds4ControlTarget.BTN_SQUARE),
                ControlElementLayout("circle", "Circle", 0.93f, 0.48f, 1.0f, 0.9f, Ds4ControlTarget.BTN_CIRCLE),
                ControlElementLayout("left_stick", "LS", 0.34f, 0.74f, 1.0f, 0.9f, Ds4ControlTarget.LEFT_STICK),
                ControlElementLayout("right_stick", "RS", 0.66f, 0.74f, 1.0f, 0.9f, Ds4ControlTarget.RIGHT_STICK),
                ControlElementLayout("l3", "L3", 0.34f, 0.50f, 0.9f, 0.8f, Ds4ControlTarget.BTN_L3),
                ControlElementLayout("r3", "R3", 0.66f, 0.50f, 0.9f, 0.8f, Ds4ControlTarget.BTN_R3),
                ControlElementLayout("share", "SHARE", 0.38f, 0.12f, 0.9f, 0.85f, Ds4ControlTarget.BTN_SHARE),
                ControlElementLayout("touchpad", "TOUCHPAD", 0.50f, 0.22f, 1.0f, 0.85f, Ds4ControlTarget.BTN_TOUCHPAD),
                ControlElementLayout("ps", "PS", 0.50f, 0.78f, 0.9f, 0.85f, Ds4ControlTarget.BTN_PS),
                ControlElementLayout("options", "OPTIONS", 0.62f, 0.12f, 0.9f, 0.85f, Ds4ControlTarget.BTN_OPTIONS)
            )
        )

        fun fpsProfile() = ControllerLayoutProfile(
            id = "fps_pro",
            name = "FPS (Claw + Precision Aim)",
            leftStickFloating = true,
            elements = defaultDs4Profile().elements.map { el ->
                when (el.id) {
                    "right_stick" -> el.copy(scale = 1.32f, normX = 0.68f, normY = 0.70f)
                    "l2" -> el.copy(scale = 1.25f, normX = 0.10f, normY = 0.16f)
                    "r2" -> el.copy(scale = 1.25f, normX = 0.90f, normY = 0.16f)
                    "cross" -> el.copy(scale = 1.15f)
                    else -> el
                }
            }
        )

        fun racingProfile() = ControllerLayoutProfile(
            id = "racing_sim",
            name = "Racing (Giant Pedals + Shift)",
            elements = defaultDs4Profile().elements.map { el ->
                when (el.id) {
                    "l2" -> el.copy(label = "BRAKE (L2)", scale = 1.45f, normX = 0.12f, normY = 0.25f)
                    "r2" -> el.copy(label = "GAS (R2)", scale = 1.45f, normX = 0.88f, normY = 0.25f)
                    "square" -> el.copy(label = "GEAR -", target = Ds4ControlTarget.BTN_L1, scale = 1.15f)
                    "circle" -> el.copy(label = "GEAR +", target = Ds4ControlTarget.BTN_R1, scale = 1.15f)
                    else -> el.copy(opacity = 0.65f)
                }
            }
        )
    }
}
