package com.ds4bridge.controller

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

private enum class StartMenuTab(val title: String) {
    CONNECT("1. Connect & Transport"),
    LAYOUT("2. Layout & Profiles"),
    GYRO("3. Gyro & Calibration"),
    HAPTICS("4. Rumble & Haptics"),
    DEVELOPER("5. Developer")
}

/**
 * Pre-gameplay Start Screen:
 * Displays app logo (`R.drawable.logo_app`), live USB/Wi-Fi badge (`R.drawable.ic_badge_usb` /
 * `R.drawable.ic_badge_wifi`), connection status & RTT latency, a clean 4-tab configuration menu,
 * and a prominent Start Gameplay button.
 */
@Composable
fun StartScreen(
    hostIp: String,
    hostPort: Int,
    pairingToken: String,
    sendRateHz: Int,
    autoUsbEnabled: Boolean,
    transportMode: TransportMode,
    liveRateHz: Float,
    liveRttMs: Float,
    netError: String?,
    profiles: List<ControllerLayoutProfile>,
    activeProfileIndex: Int,
    onSelectProfileIndex: (Int) -> Unit,
    onOpenEditLayout: () -> Unit,
    onImportProfileJson: (String) -> Boolean,
    gyroConfig: GyroConfig,
    onUpdateGyroConfig: (GyroConfig) -> Unit,
    stickSettings: StickSettings,
    onUpdateStickSettings: (StickSettings) -> Unit,
    calibrationState: GyroCalibrationState,
    onTriggerCalibration: () -> Unit,
    rumbleEnabled: Boolean,
    buttonHapticTapEnabled: Boolean,
    onUpdateHaptics: (rumble: Boolean, tap: Boolean) -> Unit,
    onApplyEndpoint: (ip: String, port: Int, token: String, rateHz: Int, autoUsb: Boolean) -> Unit,
    onStartGameplay: () -> Unit,
    onRunSetupAgain: () -> Unit = {},
    onResetSetup: () -> Unit = {}
) {
    val context = LocalContext.current
    var selectedTab by remember { mutableStateOf(StartMenuTab.CONNECT) }
    var ipInput by remember(hostIp) { mutableStateOf(hostIp) }
    var portInput by remember(hostPort) { mutableStateOf(hostPort.toString()) }
    var tokenInput by remember(pairingToken) { mutableStateOf(pairingToken) }
    var rateInput by remember(sendRateHz) { mutableIntStateOf(sendRateHz) }
    var usbToggle by remember(autoUsbEnabled) { mutableStateOf(autoUsbEnabled) }
    var qrError by remember { mutableStateOf<String?>(null) }
    var showQrScanner by remember { mutableStateOf(false) }

    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            qrError = null
            showQrScanner = true
        } else {
            qrError = "Camera permission is required to scan the QR code."
        }
    }

    var showJsonDialog by remember { mutableStateOf(false) }
    var jsonDraft by remember { mutableStateOf("") }

    val isUsb = transportMode == TransportMode.USB_ADB_REVERSE
    val activeProfile = profiles.getOrElse(activeProfileIndex) { profiles.first() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF070A14))
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // TOP HEADER: App Logo + Connection Status & USB/Wi-Fi Mini Badge + Big START Button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0D1226), RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(14.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                DrawableWithFallback(
                    resId = R.drawable.logo_app,
                    fallbackLabel = "LOGO",
                    modifier = Modifier.size(40.dp)
                )
                Column {
                    Text(
                        text = "DS4 Bridge 120Hz",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        DrawableWithFallback(
                            resId = if (isUsb) R.drawable.ic_badge_usb else R.drawable.ic_badge_wifi,
                            fallbackLabel = if (isUsb) "USB" else "WiFi",
                            modifier = Modifier.size(16.dp)
                        )
                        val rttText = if (liveRttMs > 0f) "${"%.2f".format(liveRttMs)}ms" else "—"
                        Text(
                            text = if (isUsb) {
                                "USB (adb reverse) • RTT $rttText • ${liveRateHz.toInt()}Hz"
                            } else {
                                val endpointLabel = if (ipInput.isBlank()) "unpaired" else "$ipInput:$portInput"
                                "Wi-Fi ($endpointLabel) • RTT $rttText • ${liveRateHz.toInt()}Hz"
                            },
                            color = if (netError != null) Color(0xFFFB7185)
                            else if (isUsb) Color(0xFF34D399)
                            else Color(0xFF22D3EE),
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedButton(
                    onClick = onRunSetupAgain,
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Run setup again", fontSize = 12.sp)
                }

                Button(
                    onClick = {
                        if (ipInput.trim().startsWith("ds4udp://", ignoreCase = true)) {
                            parseDs4QrUri(ipInput.trim()).onSuccess { info ->
                                ipInput = info.ip
                                portInput = info.port.toString()
                                if (info.token.isNotEmpty()) tokenInput = info.token
                                qrError = null
                            }.onFailure { err ->
                                qrError = err.message
                                return@Button
                            }
                        }
                        val finalIp = ipInput.trim()
                        val finalPort = portInput.toIntOrNull() ?: 26760
                        onApplyEndpoint(finalIp, finalPort, tokenInput.trim(), rateInput, usbToggle)
                        onStartGameplay()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490)),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp)
                ) {
                    Text(
                        text = "START GAMEPLAY",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                }
            }
        }

        // SECTION TABS BAR
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            StartMenuTab.entries.forEach { tab ->
                val active = selectedTab == tab
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .weight(1f)
                        .background(
                            if (active) Color(0xFF3B2A8F) else Color(0xFF0D1226),
                            RoundedCornerShape(10.dp)
                        )
                        .border(
                            1.dp,
                            if (active) Color(0xFF22D3EE) else Color(0xFF1B2142),
                            RoundedCornerShape(10.dp)
                        )
                        .clickable { selectedTab = tab }
                        .padding(vertical = 10.dp)
                ) {
                    Text(
                        text = tab.title,
                        color = if (active) Color.White else Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        // TAB CONTENT PANEL
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF0D1226), RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(14.dp))
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            when (selectedTab) {
                StartMenuTab.CONNECT -> {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = ipInput,
                                onValueChange = {
                                    ipInput = it
                                    qrError = null
                                },
                                label = { Text("PC LAN IP") },
                                modifier = Modifier.weight(1.4f),
                                singleLine = true
                            )
                            OutlinedTextField(
                                value = portInput,
                                onValueChange = { portInput = it },
                                label = { Text("UDP Port") },
                                modifier = Modifier.weight(0.7f),
                                singleLine = true
                            )
                            OutlinedTextField(
                                value = tokenInput,
                                onValueChange = { tokenInput = it },
                                label = { Text("Pairing Token") },
                                modifier = Modifier.weight(1.0f),
                                singleLine = true
                            )
                            Button(
                                onClick = {
                                    val granted = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.CAMERA
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (granted) {
                                        qrError = null
                                        showQrScanner = true
                                    } else {
                                        cameraLauncher.launch(Manifest.permission.CAMERA)
                                    }
                                }
                            ) {
                                Text("Scan QR")
                            }
                        }
                        if (qrError != null) {
                            Text(
                                text = qrError!!,
                                color = Color(0xFFFDA4AF),
                                fontSize = 12.sp
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Checkbox(
                                    checked = usbToggle,
                                    onCheckedChange = {
                                        usbToggle = it
                                        onApplyEndpoint(
                                            ipInput,
                                            portInput.toIntOrNull() ?: 26760,
                                            tokenInput.trim(),
                                            rateInput,
                                            it
                                        )
                                    }
                                )
                                Text(
                                    text = "Auto-switch to USB mode when plugged in (adb reverse tcp:26761)",
                                    color = Color(0xFFE2E8F0),
                                    fontSize = 12.sp
                                )
                            }

                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(60, 120, 240).forEach { hz ->
                                    FilterChip(
                                        selected = rateInput == hz,
                                        onClick = {
                                            rateInput = hz
                                            onApplyEndpoint(
                                                ipInput,
                                                portInput.toIntOrNull() ?: 26760,
                                                tokenInput.trim(),
                                                hz,
                                                usbToggle
                                            )
                                        },
                                        label = { Text("${hz}Hz") }
                                    )
                                }
                            }
                        }
                    }
                }

                StartMenuTab.LAYOUT -> {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "Active Layout Profile",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            profiles.forEachIndexed { idx, prof ->
                                FilterChip(
                                    selected = activeProfileIndex == idx,
                                    onClick = { onSelectProfileIndex(idx) },
                                    label = { Text(prof.name) }
                                )
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(
                                onClick = onOpenEditLayout,
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706))
                            ) {
                                Text("Edit Layout (Drag & Resize Image Controls)")
                            }

                            OutlinedButton(
                                onClick = {
                                    jsonDraft = activeProfile.toJsonString(pretty = true)
                                    showJsonDialog = true
                                }
                            ) {
                                Text("Export / Import Profile JSON")
                            }
                        }
                    }
                }

                StartMenuTab.GYRO -> {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = gyroConfig.enabled,
                                    onCheckedChange = {
                                        onUpdateGyroConfig(gyroConfig.copy(enabled = it))
                                    }
                                )
                                Text("Enable Gyro Aim", color = Color.White, fontSize = 12.sp)
                            }

                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    selected = gyroConfig.invertX,
                                    onClick = {
                                        onUpdateGyroConfig(gyroConfig.copy(invertX = !gyroConfig.invertX))
                                    },
                                    label = { Text("Invert X") }
                                )
                                FilterChip(
                                    selected = gyroConfig.invertY,
                                    onClick = {
                                        onUpdateGyroConfig(gyroConfig.copy(invertY = !gyroConfig.invertY))
                                    },
                                    label = { Text("Invert Y") }
                                )
                                FilterChip(
                                    selected = gyroConfig.requireHoldButton,
                                    onClick = {
                                        onUpdateGyroConfig(
                                            gyroConfig.copy(requireHoldButton = !gyroConfig.requireHoldButton)
                                        )
                                    },
                                    label = { Text("Hold L2 Gate") }
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "Sensitivity: ${"%.2f".format(gyroConfig.sensitivity)}x",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 11.sp
                                )
                                Slider(
                                    value = gyroConfig.sensitivity,
                                    onValueChange = {
                                        onUpdateGyroConfig(gyroConfig.copy(sensitivity = it))
                                    },
                                    valueRange = 0.2f..5.0f
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "Deadzone: ${"%.3f".format(gyroConfig.deadzoneRadPerSec)} rad/s",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 11.sp
                                )
                                Slider(
                                    value = gyroConfig.deadzoneRadPerSec,
                                    onValueChange = {
                                        onUpdateGyroConfig(gyroConfig.copy(deadzoneRadPerSec = it))
                                    },
                                    valueRange = 0f..0.15f
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "Smoothing: ${(gyroConfig.smoothingAlpha * 100).toInt()}%",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 11.sp
                                )
                                Slider(
                                    value = gyroConfig.smoothingAlpha,
                                    onValueChange = {
                                        onUpdateGyroConfig(gyroConfig.copy(smoothingAlpha = it))
                                    },
                                    valueRange = 0f..0.90f
                                )
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(
                                selected = gyroConfig.gateToggle,
                                onClick = { onUpdateGyroConfig(gyroConfig.copy(gateToggle = !gyroConfig.gateToggle)) },
                                label = { Text("Gate: toggle (tap on/off)") }
                            )
                            FilterChip(
                                selected = gyroConfig.toLeftStick,
                                onClick = { onUpdateGyroConfig(gyroConfig.copy(toLeftStick = !gyroConfig.toLeftStick)) },
                                label = { Text(if (gyroConfig.toLeftStick) "Gyro drives: Left stick" else "Gyro drives: Right stick") }
                            )
                        }
                        Column {
                            Text(
                                "Vertical (Y) sensitivity: ${"%.2f".format(gyroConfig.sensitivityY)}x",
                                color = Color(0xFFCBD5E1),
                                fontSize = 11.sp
                            )
                            Slider(
                                value = gyroConfig.sensitivityY,
                                onValueChange = { onUpdateGyroConfig(gyroConfig.copy(sensitivityY = it)) },
                                valueRange = 0.2f..5.0f
                            )
                        }

                        Text("Stick response", color = Color.White, fontSize = 13.sp)
                        listOf("Left stick" to true, "Right stick" to false).forEach { (label, isLeft) ->
                            val cfg = if (isLeft) stickSettings.left else stickSettings.right
                            fun update(n: StickConfig) = onUpdateStickSettings(
                                if (isLeft) stickSettings.copy(left = n) else stickSettings.copy(right = n)
                            )
                            Column {
                                Text(
                                    "$label: deadzone ${(cfg.deadzone * 100).toInt()}%, outer zone ${(cfg.outerZone * 100).toInt()}%",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 11.sp
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Slider(
                                        modifier = Modifier.weight(1f),
                                        value = cfg.deadzone,
                                        onValueChange = { update(cfg.copy(deadzone = it)) },
                                        valueRange = 0f..0.5f
                                    )
                                    Slider(
                                        modifier = Modifier.weight(1f),
                                        value = cfg.outerZone,
                                        onValueChange = { update(cfg.copy(outerZone = it)) },
                                        valueRange = 0.6f..1f
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    StickCurve.values().forEach { c ->
                                        FilterChip(
                                            selected = cfg.curve == c,
                                            onClick = { update(cfg.copy(curve = c)) },
                                            label = { Text(c.name.lowercase().replaceFirstChar { it.uppercase() }) }
                                        )
                                    }
                                    FilterChip(
                                        selected = cfg.invertY,
                                        onClick = { update(cfg.copy(invertY = !cfg.invertY)) },
                                        label = { Text("Invert Y") }
                                    )
                                }
                                if (cfg.curve == StickCurve.CUSTOM) {
                                    Text("Curve exponent: ${"%.2f".format(cfg.exponent)}", color = Color(0xFFCBD5E1), fontSize = 11.sp)
                                    Slider(
                                        value = cfg.exponent,
                                        onValueChange = { update(cfg.copy(exponent = it)) },
                                        valueRange = 0.5f..3f
                                    )
                                }
                            }
                        }

                        Button(
                            onClick = onTriggerCalibration,
                            enabled = !calibrationState.isCalibrating
                        ) {
                            Text(
                                if (calibrationState.isCalibrating)
                                    "Calibrating Still Drift... ${(calibrationState.progress * 100).toInt()}%"
                                else
                                    "Calibrate Stationary Drift (Bias Z: ${"%.3f".format(calibrationState.biasZ)} rad/s)"
                            )
                        }
                    }
                }

                StartMenuTab.HAPTICS -> {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = rumbleEnabled,
                                onCheckedChange = {
                                    onUpdateHaptics(it, buttonHapticTapEnabled)
                                }
                            )
                            Text(
                                "Enable PC DualShock 4 Rumble / Force-Feedback Vibration",
                                color = Color.White,
                                fontSize = 13.sp
                            )
                        }

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = buttonHapticTapEnabled,
                                onCheckedChange = {
                                    onUpdateHaptics(rumbleEnabled, it)
                                }
                            )
                            Text(
                                "Enable Haptic Tap Feedback on Button Presses",
                                color = Color.White,
                                fontSize = 13.sp
                            )
                        }
                    }
                }

                StartMenuTab.DEVELOPER -> {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "Developer & Setup Testing",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(
                                onClick = onResetSetup,
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE11D48))
                            ) {
                                Text("Reset setup")
                            }
                            OutlinedButton(onClick = onRunSetupAgain) {
                                Text("Run setup again")
                            }
                        }
                    }
                }
            }
        }
    }

    if (showJsonDialog) {
        AlertDialog(
            onDismissRequest = { showJsonDialog = false },
            title = { Text("Profile JSON Import / Export") },
            text = {
                OutlinedTextField(
                    value = jsonDraft,
                    onValueChange = { jsonDraft = it },
                    modifier = Modifier.fillMaxWidth().height(180.dp)
                )
            },
            confirmButton = {
                Button(onClick = {
                    if (onImportProfileJson(jsonDraft)) {
                        showJsonDialog = false
                    }
                }) {
                    Text("Import & Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showJsonDialog = false }) {
                    Text("Close")
                }
            }
        )
    }

    if (showQrScanner) {
        QrScannerDialog(
            onDismiss = { showQrScanner = false },
            onPaired = { info ->
                ipInput = info.ip
                portInput = info.port.toString()
                tokenInput = info.token
                qrError = null
                showQrScanner = false
                onApplyEndpoint(info.ip, info.port, info.token, rateInput, usbToggle)
            }
        )
    }
}
