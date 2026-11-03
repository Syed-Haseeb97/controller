package com.ds4bridge.controller

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Pure Fullscreen Immersive Gameplay Screen:
 * - Renders ONLY the image-based controller layout (`painterResource(R.drawable.*)`) and nothing else.
 * - Zero HUD bars, zero text labels on controls, zero Canvas shapes.
 * - Pressed state scales image controls to `0.92f` and lowers alpha (`opacity * 0.68f`).
 * - One small semi-transparent settings gear (`R.drawable.ic_settings`) in the top-right corner
 *   toggles a 40%-width slide-in Settings Side Panel.
 * - While the side panel is open, all sticks and buttons are released to neutral (`ControllerState()`)
 *   and pointer events on the panel/scrim are consumed so touches never leak to the gamepad underneath.
 */
@Composable
fun GameplayScreen(
    touchStateRef: AtomicReference<ControllerState>,
    hapticsManager: HapticsAndRumbleManager,
    profiles: List<ControllerLayoutProfile>,
    activeProfileIndex: Int,
    onSelectProfileIndex: (Int) -> Unit,
    onUpdateProfileElements: (List<ControlElementLayout>) -> Unit,
    gyroConfig: GyroConfig,
    onUpdateGyroConfig: (GyroConfig) -> Unit,
    transportMode: TransportMode,
    liveRttMs: Float,
    liveRateHz: Float,
    initialEditMode: Boolean,
    onDisconnectToStart: () -> Unit
) {
    val activeProfile = profiles.getOrElse(activeProfileIndex) { profiles.first() }
    var uiState by remember { mutableStateOf(ControllerState()) }
    var isSettingsPanelOpen by remember { mutableStateOf(false) }
    var editMode by remember { mutableStateOf(initialEditMode) }
    var selectedEditId by remember { mutableStateOf(activeProfile.elements.firstOrNull()?.id ?: "cross") }

    var rootSize by remember { mutableStateOf(IntSize.Zero) }
    val buttonBounds = remember { mutableStateMapOf<String, Rect>() }
    var leftStickRect by remember { mutableStateOf(Rect.Zero) }
    var rightStickRect by remember { mutableStateOf(Rect.Zero) }

    var leftStickPointer by remember { mutableStateOf<PointerId?>(null) }
    var rightStickPointer by remember { mutableStateOf<PointerId?>(null) }
    var leftStickNorm by remember { mutableStateOf(Offset.Zero) }
    var rightStickNorm by remember { mutableStateOf(Offset.Zero) }
    // Floating left stick: the stick centre is wherever the thumb first lands (null = fixed stick)
    var leftFloatOrigin by remember { mutableStateOf<Offset?>(null) }
    // Layout editor helpers: undo history (per editing session) and grid snapping
    val undoStack = remember { mutableStateListOf<List<ControlElementLayout>>() }
    var snapToGrid by remember { mutableStateOf(true) }

    // Safety Rule: When the Settings Panel opens (or Edit Mode activates), release sticks & buttons
    // to neutral so `UdpSenderThread` keeps streaming a clean released state with zero stuck inputs.
    LaunchedEffect(isSettingsPanelOpen, editMode) {
        if (isSettingsPanelOpen || editMode) {
            leftStickPointer = null
            rightStickPointer = null
            leftStickNorm = Offset.Zero
            rightStickNorm = Offset.Zero
            leftFloatOrigin = null
            val released = ControllerState()
            touchStateRef.set(released)
            uiState = released
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF070A14))
            .onSizeChanged { rootSize = it }
            .pointerInput(isSettingsPanelOpen, editMode, activeProfile) {
                if (isSettingsPanelOpen || editMode) return@pointerInput
                awaitEachGesture {
                    while (true) {
                        val event = awaitPointerEvent()
                        val activePointers = event.changes.filter { it.pressed }

                        if (leftStickPointer != null && activePointers.none { it.id == leftStickPointer }) {
                            leftStickPointer = null
                            leftStickNorm = Offset.Zero
                            leftFloatOrigin = null
                        }
                        if (rightStickPointer != null && activePointers.none { it.id == rightStickPointer }) {
                            rightStickPointer = null
                            rightStickNorm = Offset.Zero
                        }

                        var newMask = 0
                        var l2Val = 0
                        var r2Val = 0
                        // Hidden controls neither draw nor receive touches (stale bounds are ignored)
                        val leftStickVisible = activeProfile.elements.any { it.target == Ds4ControlTarget.LEFT_STICK && it.visible }
                        val rightStickVisible = activeProfile.elements.any { it.target == Ds4ControlTarget.RIGHT_STICK && it.visible }
                        val floating = activeProfile.leftStickFloating && leftStickVisible

                        for (change in activePointers) {
                            val pos = change.position
                            change.consume()

                            val overButton = activeProfile.elements.any { e ->
                                e.visible && !e.target.isAxis && buttonBounds[e.id]?.contains(pos) == true
                            }
                            val startsLeft = leftStickVisible && (leftStickRect.contains(pos) ||
                                (floating && !overButton && pos.x < rootSize.width * 0.5f))
                            if (change.id == leftStickPointer || (leftStickPointer == null && startsLeft)) {
                                if (leftStickPointer == null) {
                                    leftFloatOrigin = if (floating && !leftStickRect.contains(pos)) pos else null
                                }
                                leftStickPointer = change.id
                                val origin = leftFloatOrigin
                                leftStickNorm = if (origin != null) {
                                    computeClampedOffset(pos, Rect(origin, (leftStickRect.width / 2f).coerceAtLeast(40f)))
                                } else computeClampedOffset(pos, leftStickRect)
                                continue
                            }

                            if (change.id == rightStickPointer || (rightStickPointer == null && rightStickVisible && rightStickRect.contains(pos))) {
                                rightStickPointer = change.id
                                rightStickNorm = computeClampedOffset(pos, rightStickRect)
                                continue
                            }

                            for (el in activeProfile.elements) {
                                if (el.target.isAxis || !el.visible) continue
                                val rect = buttonBounds[el.id] ?: continue
                                if (rect.contains(pos)) {
                                    newMask = newMask or el.target.buttonMask
                                    if (el.target.isTrigger) {
                                        // Analog trigger: touching the top of the key = ~40 %, sliding down = 100 %.
                                        // (Digital L2/R2 on the PC is derived from this value > 10.)
                                        val depth = ((pos.y - rect.top) / rect.height.coerceAtLeast(1f)).coerceIn(0f, 1f)
                                        val v = (100 + depth * 155f).roundToInt().coerceIn(0, 255)
                                        if (el.target == Ds4ControlTarget.L2_TRIGGER) l2Val = maxOf(l2Val, v)
                                        else r2Val = maxOf(r2Val, v)
                                    }
                                }
                            }
                        }

                        if ((newMask and uiState.buttonsMask.inv()) != 0) {
                            hapticsManager.triggerButtonPressTap()
                        }

                        val nextState = ControllerState(
                            buttonsMask = newMask,
                            lx = ControllerState.floatAxisToInt16(leftStickNorm.x),
                            ly = ControllerState.floatAxisToInt16(leftStickNorm.y),
                            rx = ControllerState.floatAxisToInt16(rightStickNorm.x),
                            ry = ControllerState.floatAxisToInt16(rightStickNorm.y),
                            l2 = l2Val,
                            r2 = r2Val
                        )
                        touchStateRef.set(nextState)
                        uiState = nextState

                        if (activePointers.isEmpty()) break
                    }
                }
            }
    ) {
        // 1. PURE IMAGE-BASED CONTROLLER ELEMENTS (No text, no Canvas, no HUD)
        val density = LocalDensity.current
        for (el in activeProfile.elements) {
            if (!el.visible && !editMode) {
                buttonBounds.remove(el.id) // no stale hit-test rectangle for hidden controls
                continue
            }
            val centerX = (el.normX * rootSize.width).roundToInt()
            val centerY = (el.normY * rootSize.height).roundToInt()

            if (el.target == Ds4ControlTarget.LEFT_STICK || el.target == Ds4ControlTarget.RIGHT_STICK) {
                val isLeft = el.target == Ds4ControlTarget.LEFT_STICK
                val stickOffset = if (isLeft) leftStickNorm else rightStickNorm
                val isStickActive = hypot(stickOffset.x, stickOffset.y) > 0.04f
                val baseDp = (140f * el.scale).dp
                val capDp = (64f * el.scale).dp
                val basePx = with(density) { baseDp.toPx() }
                val maxTravelPx = basePx * 0.28f

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .offset {
                            IntOffset(
                                x = centerX - (basePx / 2f).roundToInt(),
                                y = centerY - (basePx / 2f).roundToInt()
                            )
                        }
                        .size(baseDp)
                        .onGloballyPositioned { coords ->
                            if (isLeft) leftStickRect = coords.boundsInRoot()
                            else rightStickRect = coords.boundsInRoot()
                        }
                        .then(
                            if (editMode) {
                                Modifier
                                    .border(
                                        width = if (selectedEditId == el.id) 2.dp else 1.dp,
                                        color = if (selectedEditId == el.id) Color(0xFFF59E0B) else Color(0x6694A3B8),
                                        shape = RoundedCornerShape(72.dp)
                                    )
                                    .pointerInput(el.id, rootSize) {
                                        detectDragGestures(
                                            onDragStart = {
                                                selectedEditId = el.id
                                                undoStack.add(activeProfile.elements)
                                            },
                                            onDrag = { change, dragAmount ->
                                                change.consume()
                                                if (rootSize.width > 0 && rootSize.height > 0) {
                                                    val nx = snapNorm(el.normX + dragAmount.x / rootSize.width, snapToGrid).coerceIn(0.05f, 0.95f)
                                                    val ny = snapNorm(el.normY + dragAmount.y / rootSize.height, snapToGrid).coerceIn(0.08f, 0.92f)
                                                    onUpdateProfileElements(
                                                        activeProfile.elements.map {
                                                            if (it.id == el.id) it.copy(normX = nx, normY = ny) else it
                                                        }
                                                    )
                                                }
                                            }
                                        )
                                    }
                            } else Modifier
                        )
                ) {
                    // Stick Base Image (`R.drawable.stick_base`)
                    DrawableWithFallback(
                        resId = R.drawable.stick_base,
                        fallbackLabel = if (isLeft) "LS" else "RS",
                        isCircular = true,
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer {
                                alpha = if (isStickActive) el.opacity * 0.68f else el.opacity
                            }
                    )
                    // Stick Cap Image (`R.drawable.stick_cap`) — scales to 0.92x when deflected
                    DrawableWithFallback(
                        resId = R.drawable.stick_cap,
                        fallbackLabel = el.label,
                        isCircular = true,
                        modifier = Modifier
                            .size(capDp)
                            .offset {
                                IntOffset(
                                    x = (stickOffset.x * maxTravelPx).roundToInt(),
                                    y = (stickOffset.y * maxTravelPx).roundToInt()
                                )
                            }
                            .graphicsLayer {
                                val s = if (isStickActive) 0.92f else 1.0f
                                scaleX = s
                                scaleY = s
                                alpha = if (isStickActive) el.opacity * 0.68f else el.opacity
                            }
                    )
                }
            } else {
                // Image-based Button (`R.drawable.btn_*` / `R.drawable.dpad_*`)
                val isPressed = (uiState.buttonsMask and el.target.buttonMask) != 0
                val (baseW, baseH) = el.target.baseSizeDp()
                val widthDp = (baseW * el.scale).dp
                val heightDp = (baseH * el.scale).dp
                val wPx = with(density) { widthDp.toPx() }
                val hPx = with(density) { heightDp.toPx() }
                val isCircleBtn = el.target in listOf(
                    Ds4ControlTarget.BTN_CROSS, Ds4ControlTarget.BTN_CIRCLE,
                    Ds4ControlTarget.BTN_SQUARE, Ds4ControlTarget.BTN_TRIANGLE, Ds4ControlTarget.BTN_PS
                )

                DrawableWithFallback(
                    resId = el.resolveDrawableRes(),
                    fallbackLabel = el.label,
                    isCircular = isCircleBtn,
                    tint = if (isPressed && el.target.tintsOnPress) Color(0xFF22D3EE) else null,
                    modifier = Modifier
                        .offset {
                            IntOffset(
                                x = centerX - (wPx / 2f).roundToInt(),
                                y = centerY - (hPx / 2f).roundToInt()
                            )
                        }
                        .size(widthDp, heightDp)
                        .onGloballyPositioned { coords ->
                            buttonBounds[el.id] = coords.boundsInRoot()
                        }
                        .graphicsLayer {
                            // Pressed state: scale to 0.92x and lower alpha (no redrawing)
                            val pressedScale = if (isPressed) 0.92f else 1.0f
                            scaleX = pressedScale
                            scaleY = pressedScale
                            alpha = (if (isPressed) el.opacity * 0.68f else el.opacity) * (if (el.visible) 1f else 0.3f)
                        }
                        .then(
                            if (editMode) {
                                Modifier
                                    .border(
                                        width = if (selectedEditId == el.id) 2.dp else 1.dp,
                                        color = if (selectedEditId == el.id) Color(0xFFF59E0B) else Color(0x6694A3B8),
                                        shape = RoundedCornerShape(10.dp)
                                    )
                                    .pointerInput(el.id, rootSize) {
                                        detectDragGestures(
                                            onDragStart = {
                                                selectedEditId = el.id
                                                undoStack.add(activeProfile.elements)
                                            },
                                            onDrag = { change, dragAmount ->
                                                change.consume()
                                                if (rootSize.width > 0 && rootSize.height > 0) {
                                                    val nx = snapNorm(el.normX + dragAmount.x / rootSize.width, snapToGrid).coerceIn(0.04f, 0.96f)
                                                    val ny = snapNorm(el.normY + dragAmount.y / rootSize.height, snapToGrid).coerceIn(0.06f, 0.94f)
                                                    onUpdateProfileElements(
                                                        activeProfile.elements.map {
                                                            if (it.id == el.id) it.copy(normX = nx, normY = ny) else it
                                                        }
                                                    )
                                                }
                                            }
                                        )
                                    }
                            } else Modifier
                        )
                )
            }
        }

        // Compact Edit Mode Overlay Bar (only visible when Edit Layout is toggled ON)
        if (editMode) {
            val selectedEl = activeProfile.elements.find { it.id == selectedEditId }
            Row(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 10.dp)
                    .background(Color(0xEE0D1226), RoundedCornerShape(12.dp))
                    .border(1.dp, Color(0xFFF59E0B), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (selectedEl != null) {
                    Text(
                        text = "Size ${(selectedEl.scale * 100).toInt()}%",
                        color = Color.White,
                        fontSize = 11.sp
                    )
                    Slider(
                        value = selectedEl.scale,
                        onValueChange = { s ->
                            onUpdateProfileElements(
                                activeProfile.elements.map {
                                    if (it.id == selectedEl.id) it.copy(scale = s) else it
                                }
                            )
                        },
                        valueRange = 0.6f..1.8f,
                        modifier = Modifier.width(110.dp)
                    )
                    Text(
                        text = "Alpha ${(selectedEl.opacity * 100).toInt()}%",
                        color = Color.White,
                        fontSize = 11.sp
                    )
                    Slider(
                        value = selectedEl.opacity,
                        onValueChange = { a ->
                            onUpdateProfileElements(
                                activeProfile.elements.map {
                                    if (it.id == selectedEl.id) it.copy(opacity = a) else it
                                }
                            )
                        },
                        valueRange = 0.2f..1.0f,
                        modifier = Modifier.width(110.dp)
                    )
                }
                if (selectedEl != null) {
                    TextButton(onClick = {
                        undoStack.add(activeProfile.elements)
                        onUpdateProfileElements(
                            activeProfile.elements.map {
                                if (it.id == selectedEl.id) it.copy(visible = !it.visible) else it
                            }
                        )
                    }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                        Text(if (selectedEl.visible) "Hide" else "Show", fontSize = 11.sp)
                    }
                }
                TextButton(
                    onClick = {
                        undoStack.removeLastOrNull()?.let { onUpdateProfileElements(it) }
                    },
                    enabled = undoStack.isNotEmpty(),
                    contentPadding = PaddingValues(horizontal = 8.dp)
                ) { Text("Undo", fontSize = 11.sp) }
                TextButton(
                    onClick = {
                        undoStack.add(activeProfile.elements)
                        onUpdateProfileElements(ControllerLayoutProfile.factoryElementsFor(activeProfile.id))
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp)
                ) { Text("Reset", fontSize = 11.sp) }
                TextButton(onClick = { snapToGrid = !snapToGrid }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                    Text(if (snapToGrid) "Grid: on" else "Grid: off", fontSize = 11.sp)
                }
                Button(
                    onClick = { editMode = false },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B)),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text("Save Layout", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // 2. ONLY EXTRA ELEMENT ON GAMEPLAY SCREEN: Small semi-transparent Settings Gear in Top-Right
        DrawableWithFallback(
            resId = R.drawable.ic_settings,
            fallbackLabel = "GEAR",
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(14.dp)
                .size(32.dp)
                .graphicsLayer {
                    alpha = if (isSettingsPanelOpen) 0.90f else 0.42f
                }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) {
                    isSettingsPanelOpen = !isSettingsPanelOpen
                }
        )

        // 3. TOUCH-BLOCKING SCRIM + 40%-WIDTH SLIDE-IN SETTINGS SIDE PANEL
        if (isSettingsPanelOpen) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x88000000))
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val ev = awaitPointerEvent()
                                ev.changes.forEach { it.consume() }
                                if (ev.changes.any { !it.pressed }) {
                                    isSettingsPanelOpen = false
                                }
                            }
                        }
                    }
            )
        }

        AnimatedVisibility(
            visible = isSettingsPanelOpen,
            enter = slideInHorizontally(initialOffsetX = { fullWidth -> fullWidth }),
            exit = slideOutHorizontally(targetOffsetX = { fullWidth -> fullWidth }),
            modifier = Modifier.align(Alignment.CenterEnd)
        ) {
            val isUsb = transportMode == TransportMode.USB_ADB_REVERSE
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(0.40f)
                    .background(Color(0xF50D1226))
                    .border(1.dp, Color(0xFF1B2142))
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val ev = awaitPointerEvent()
                                ev.changes.forEach { it.consume() }
                            }
                        }
                    }
                    .padding(18.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            DrawableWithFallback(
                                resId = if (isUsb) R.drawable.ic_badge_usb else R.drawable.ic_badge_wifi,
                                fallbackLabel = if (isUsb) "USB" else "WiFi",
                                modifier = Modifier.size(18.dp)
                            )
                            val rttText = if (liveRttMs > 0f) "${"%.2f".format(liveRttMs)}ms" else "—"
                            Text(
                                text = if (isUsb) "USB • $rttText"
                                else "Wi-Fi • $rttText",
                                color = if (isUsb) Color(0xFF34D399) else Color(0xFF22D3EE),
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Text(
                            text = "${liveRateHz.toInt()}Hz",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    HorizontalDivider(color = Color(0xFF1B2142))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Gyro Aim", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Switch(
                            checked = gyroConfig.enabled,
                            onCheckedChange = { onUpdateGyroConfig(gyroConfig.copy(enabled = it)) }
                        )
                    }

                    Column {
                        Text(
                            text = "Gyro Sensitivity: ${"%.2f".format(gyroConfig.sensitivity)}x",
                            color = Color(0xFFCBD5E1),
                            fontSize = 11.sp
                        )
                        Slider(
                            value = gyroConfig.sensitivity,
                            onValueChange = { onUpdateGyroConfig(gyroConfig.copy(sensitivity = it)) },
                            valueRange = 0.2f..5.0f
                        )
                    }

                    Text("Layout Profile", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        profiles.forEachIndexed { idx, prof ->
                            FilterChip(
                                selected = activeProfileIndex == idx,
                                onClick = { onSelectProfileIndex(idx) },
                                label = { Text(prof.name, fontSize = 11.sp) }
                            )
                        }
                    }

                    Button(
                        onClick = {
                            isSettingsPanelOpen = false
                            editMode = true
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706))
                    ) {
                        Text("Edit Layout", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            isSettingsPanelOpen = false
                            onDisconnectToStart()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Back to Start Screen", fontSize = 12.sp)
                    }
                    Button(
                        onClick = {
                            isSettingsPanelOpen = false
                            onDisconnectToStart()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626))
                    ) {
                        Text("Disconnect", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/** Optionally snaps a normalized coordinate to a 2.5 % grid. */
private fun snapNorm(v: Float, snap: Boolean): Float =
    if (snap) (v / 0.025f).roundToInt() * 0.025f else v

private fun computeClampedOffset(touchPos: Offset, rect: Rect): Offset {
    val cx = rect.center.x
    val cy = rect.center.y
    val maxR = (rect.width.coerceAtMost(rect.height) / 2f).coerceAtLeast(1f)
    val dx = (touchPos.x - cx) / maxR
    val dy = (touchPos.y - cy) / maxR
    val dist = hypot(dx, dy)
    return if (dist <= 1f) {
        Offset(dx, dy)
    } else {
        val angle = atan2(dy, dx)
        Offset(cos(angle), sin(angle))
    }
}
