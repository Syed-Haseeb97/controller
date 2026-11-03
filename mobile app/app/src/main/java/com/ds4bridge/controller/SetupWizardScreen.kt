package com.ds4bridge.controller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

const val SETUP_PREFS_NAME = "ds4_setup_prefs"
const val KEY_SETUP_COMPLETED = "setup_completed"
const val KEY_SETUP_STEP = "setup_current_step"
const val KEY_SETUP_CONN_MODE = "setup_conn_mode"

enum class WizardConnectionChoice(val label: String) {
    WIFI("Wi-Fi"),
    USB("USB cable"),
    BOTH("Both")
}

/**
 * 7-Step First-Run Setup Wizard for Android:
 *  1. Welcome
 *  2. Install PC app
 *  3. Choose connection (Wi-Fi QR/IP, USB debugging guide + live check, or Both)
 *  4. Test connection (send test packet, green check + latency, or error + fix suggestion)
 *  5. Calibrate gyro (flat & still progress ring + sensitivity slider with live tilt dot)
 *  6. Pick layout (Default DS4, FPS, Racing with preview image + button tap check)
 *  7. Done (summary + Start button to open Menu)
 *
 * Persists `setup_completed` and `setup_current_step` so quitting mid-way resumes at the last step.
 * Every step includes Back, Skip, and Next, plus a "Step X of 7" progress indicator.
 */
@Composable
fun SetupWizardScreen(
    initialStep: Int,
    onStepChanged: (Int) -> Unit,
    hostIp: String,
    hostPort: Int,
    pairingToken: String,
    sendRateHz: Int,
    transportMode: TransportMode,
    liveRttMs: Float,
    netError: String?,
    gyroConfig: GyroConfig,
    onUpdateGyroConfig: (GyroConfig) -> Unit,
    calibrationState: GyroCalibrationState,
    onTriggerCalibration: () -> Unit,
    liveTiltOffset: Pair<Float, Float>,
    profiles: List<ControllerLayoutProfile>,
    activeProfileIndex: Int,
    onSelectProfileIndex: (Int) -> Unit,
    onSendTestButtonTap: (Int) -> Unit,
    onApplyEndpoint: (ip: String, port: Int, token: String, rateHz: Int, autoUsb: Boolean) -> Unit,
    onRunRealConnectionTest: (
        ip: String,
        port: Int,
        useUsb: Boolean,
        token: String,
        onResult: (Result<Float>) -> Unit
    ) -> Unit,
    onFinishSetup: () -> Unit
) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(SETUP_PREFS_NAME, Context.MODE_PRIVATE) }

    var currentStep by remember { mutableIntStateOf(initialStep.coerceIn(1, 7)) }
    var connChoice by remember {
        val saved = prefs.getString(KEY_SETUP_CONN_MODE, WizardConnectionChoice.BOTH.name)
        mutableStateOf(
            runCatching { WizardConnectionChoice.valueOf(saved ?: "BOTH") }
                .getOrDefault(WizardConnectionChoice.BOTH)
        )
    }

    var ipDraft by remember(hostIp) { mutableStateOf(hostIp) }
    var portDraft by remember(hostPort) { mutableStateOf(hostPort.toString()) }
    var tokenDraft by remember(pairingToken) { mutableStateOf(pairingToken) }
    var qrScanStatus by remember { mutableStateOf<String?>(null) }
    var qrScanError by remember { mutableStateOf<String?>(null) }
    var showCameraScannerDialog by remember { mutableStateOf(false) }

    // Step 3: Camera permission requested ONLY when user taps Scan QR in Step 3
    var cameraPermissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        cameraPermissionGranted = granted
        if (granted) {
            qrScanError = null
            showCameraScannerDialog = true
        } else {
            qrScanError = "Camera permission declined. Enter the PC IP, port, and token manually below."
        }
    }

    // Step 4: Connection Test state
    var testStatus by remember { mutableStateOf("idle") } // "idle", "testing", "ok", "failed"
    var measuredTestRttMs by remember { mutableStateOf<Float?>(null) }
    var testErrorDetail by remember { mutableStateOf<String?>(null) }

    // Step 5: Sensor permission/check requested ONLY at Step 5
    var sensorReady by remember { mutableStateOf(true) }
    val sensorPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        sensorReady = granted
        if (granted) onTriggerCalibration()
    }

    // Step 6: Button tap check & Vibrate permission requested ONLY at Step 6
    var buttonTapFeedback by remember { mutableStateOf<String?>(null) }

    fun goToStep(step: Int) {
        val clamped = step.coerceIn(1, 7)
        currentStep = clamped
        prefs.edit().putInt(KEY_SETUP_STEP, clamped).apply()
        onStepChanged(clamped)
    }

    fun applyConnectionSettings() {
        val rawTrimmed = ipDraft.trim()
        if (rawTrimmed.startsWith("ds4udp://", ignoreCase = true)) {
            parseDs4QrUri(rawTrimmed).onSuccess { info ->
                ipDraft = info.ip
                portDraft = info.port.toString()
                if (info.token.isNotEmpty()) tokenDraft = info.token
            }.onFailure { err ->
                qrScanError = err.message
            }
        }
        val finalIp = ipDraft.trim()
        val finalPort = portDraft.toIntOrNull() ?: 26760
        val useUsb = connChoice != WizardConnectionChoice.WIFI
        prefs.edit().putString(KEY_SETUP_CONN_MODE, connChoice.name).apply()
        onApplyEndpoint(finalIp, finalPort, tokenDraft.trim(), sendRateHz, useUsb)
    }

    fun runConnectionTest() {
        applyConnectionSettings()
        testStatus = "testing"
        measuredTestRttMs = null
        testErrorDetail = null
        val finalIp = ipDraft.trim()
        val finalPort = portDraft.toIntOrNull() ?: 26760
        val useUsb = connChoice != WizardConnectionChoice.WIFI
        onRunRealConnectionTest(finalIp, finalPort, useUsb, tokenDraft.trim()) { result ->
            ContextCompat.getMainExecutor(context).execute {
                result.onSuccess { rtt ->
                    measuredTestRttMs = rtt
                    testStatus = "ok"
                }.onFailure { err ->
                    measuredTestRttMs = null
                    testStatus = "failed"
                    testErrorDetail = err.message
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF070A14))
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // TOP BAR: Progress Indicator ("Step X of 7") + Minimal Step Dots
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Image(
                    painter = painterResource(id = R.drawable.logo_app),
                    contentDescription = "App Logo",
                    modifier = Modifier.size(28.dp)
                )
                Text(
                    text = "Step $currentStep of 7",
                    color = Color(0xFF22D3EE),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (s in 1..7) {
                    Box(
                        modifier = Modifier
                            .width(if (s == currentStep) 22.dp else 8.dp)
                            .height(6.dp)
                            .background(
                                if (s <= currentStep) Color(0xFF22D3EE) else Color(0xFF1B2142),
                                RoundedCornerShape(3.dp)
                            )
                    )
                }
            }
        }

        // CENTER CARD: Single Clear Action Per Step
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(vertical = 12.dp)
                .background(Color(0xFF0D1226), RoundedCornerShape(16.dp))
                .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(16.dp))
                .padding(20.dp),
            contentAlignment = Alignment.Center
        ) {
            when (currentStep) {
                // STEP 1: WELCOME
                1 -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.logo_app),
                            contentDescription = "App Logo",
                            modifier = Modifier.size(64.dp)
                        )
                        Text(
                            text = "DS4 Bridge 120Hz",
                            color = Color.White,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Use your phone as a low-latency 120Hz DualShock 4 controller on your Windows PC.",
                            color = Color(0xFF94A3B8),
                            fontSize = 13.sp
                        )
                        Button(
                            onClick = { goToStep(2) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("Get started", fontWeight = FontWeight.Bold)
                        }
                    }
                }

                // STEP 2: INSTALL PC APP
                2 -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Install the PC Receiver App",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Download and run DS4Bridge120Hz.exe (or python ds4_tray_app.py) on your Windows PC.",
                            color = Color(0xFFCBD5E1),
                            fontSize = 13.sp
                        )
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFF070A14), RoundedCornerShape(10.dp))
                                .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(10.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = "• Required: ViGEmBus driver (virtual DualShock 4 driver for Windows)",
                                color = Color(0xFF22D3EE),
                                fontSize = 12.sp
                            )
                            Text(
                                text = "• Optional (Wired Mode): Enable Android USB debugging for 0.8ms USB cable play",
                                color = Color(0xFF94A3B8),
                                fontSize = 12.sp
                            )
                        }
                        Button(
                            onClick = { goToStep(3) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490)),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("I've installed it", fontWeight = FontWeight.Bold)
                        }
                    }
                }

                // STEP 3: CHOOSE CONNECTION
                3 -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Choose Connection Type",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            WizardConnectionChoice.entries.forEach { mode ->
                                FilterChip(
                                    selected = connChoice == mode,
                                    onClick = { connChoice = mode },
                                    label = { Text(mode.label) }
                                )
                            }
                        }

                        if (connChoice == WizardConnectionChoice.WIFI || connChoice == WizardConnectionChoice.BOTH) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                OutlinedTextField(
                                    value = ipDraft,
                                    onValueChange = {
                                        ipDraft = it
                                        qrScanError = null
                                    },
                                    label = { Text("PC IP Address") },
                                    modifier = Modifier.weight(1.4f),
                                    singleLine = true
                                )
                                OutlinedTextField(
                                    value = portDraft,
                                    onValueChange = { portDraft = it },
                                    label = { Text("Port") },
                                    modifier = Modifier.weight(0.7f),
                                    singleLine = true
                                )
                                OutlinedTextField(
                                    value = tokenDraft,
                                    onValueChange = { tokenDraft = it },
                                    label = { Text("Token") },
                                    modifier = Modifier.weight(1.0f),
                                    singleLine = true
                                )
                                Button(
                                    onClick = {
                                        if (cameraPermissionGranted) {
                                            qrScanError = null
                                            showCameraScannerDialog = true
                                        } else {
                                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                                        }
                                    }
                                ) {
                                    Text("Scan QR")
                                }
                            }
                            if (qrScanError != null) {
                                Text(
                                    text = qrScanError!!,
                                    color = Color(0xFFFDA4AF),
                                    fontSize = 11.sp
                                )
                            } else {
                                Text(
                                    text = qrScanStatus ?: "Camera permission is used only to scan the PC pairing QR code.",
                                    color = if (qrScanStatus != null) Color(0xFF34D399) else Color(0xFF94A3B8),
                                    fontSize = 11.sp
                                )
                            }
                        }

                        if (connChoice == WizardConnectionChoice.USB || connChoice == WizardConnectionChoice.BOTH) {
                            val usbDetected = transportMode == TransportMode.USB_ADB_REVERSE
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF070A14), RoundedCornerShape(10.dp))
                                    .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(10.dp))
                                    .padding(10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Image(
                                        painter = painterResource(id = R.drawable.ic_badge_usb),
                                        contentDescription = "USB",
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Text(
                                        text = "Settings > About phone > Tap Build number 7x > Enable USB debugging.",
                                        color = Color(0xFFCBD5E1),
                                        fontSize = 11.sp
                                    )
                                }
                                Text(
                                    text = if (usbDetected) "Device detected" else "Waiting for USB...",
                                    color = if (usbDetected) Color(0xFF34D399) else Color(0xFFFBBF24),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                    }
                }

                // STEP 4: TEST CONNECTION
                4 -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Test Connection",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Send a 48-byte test packet and wait up to 2 seconds for the PC's 16-byte echo.",
                            color = Color(0xFF94A3B8),
                            fontSize = 12.sp
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { runConnectionTest() },
                                enabled = testStatus != "testing",
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490))
                            ) {
                                Text(
                                    when (testStatus) {
                                        "testing" -> "Waiting for 16B echo (up to 2s)..."
                                        "failed" -> "Try again"
                                        else -> "Send test packet"
                                    }
                                )
                            }
                        }

                        if (testStatus == "ok" && measuredTestRttMs != null) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF062E22), RoundedCornerShape(10.dp))
                                    .border(1.dp, Color(0xFF10B981), RoundedCornerShape(10.dp))
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Connected — 16-byte echo received",
                                    color = Color(0xFF34D399),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "${"%.2f".format(measuredTestRttMs)} ms RTT",
                                    color = Color.White,
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        } else if (testStatus == "failed") {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF2D0A12), RoundedCornerShape(10.dp))
                                    .border(1.dp, Color(0xFFF43F5E), RoundedCornerShape(10.dp))
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = testErrorDetail ?: "No response from PC receiver.",
                                    color = Color(0xFFFDA4AF),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }

                // STEP 5: CALIBRATE GYRO
                5 -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Calibrate Gyroscope",
                                    color = Color.White,
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "Place your phone flat and still.",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 12.sp
                                )
                            }

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                CircularProgressIndicator(
                                    progress = {
                                        if (calibrationState.isCalibrating) calibrationState.progress else 1f
                                    },
                                    modifier = Modifier.size(32.dp),
                                    color = Color(0xFF22D3EE),
                                    strokeWidth = 3.dp
                                )
                                Button(
                                    onClick = {
                                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                            sensorPermissionLauncher.launch(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS)
                                        } else {
                                            onTriggerCalibration()
                                        }
                                    },
                                    enabled = !calibrationState.isCalibrating
                                ) {
                                    Text(
                                        if (calibrationState.isCalibrating)
                                            "${(calibrationState.progress * 100).toInt()}%"
                                        else
                                            "Calibrate"
                                    )
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Sensitivity: ${"%.2f".format(gyroConfig.sensitivity)}x",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 12.sp
                                )
                                Slider(
                                    value = gyroConfig.sensitivity,
                                    onValueChange = {
                                        onUpdateGyroConfig(gyroConfig.copy(sensitivity = it))
                                    },
                                    valueRange = 0.2f..5.0f
                                )
                            }

                            // Live preview dot that moves as the phone tilts
                            Box(
                                modifier = Modifier
                                    .size(72.dp)
                                    .background(Color(0xFF070A14), RoundedCornerShape(36.dp))
                                    .border(1.dp, Color(0xFF2E3560), RoundedCornerShape(36.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                Canvas(modifier = Modifier.fillMaxSize()) {
                                    val cx = size.width / 2f + (liveTiltOffset.first * size.width * 0.35f)
                                    val cy = size.height / 2f + (liveTiltOffset.second * size.height * 0.35f)
                                    drawCircle(
                                        color = Color(0xFF22D3EE),
                                        radius = 8.dp.toPx(),
                                        center = Offset(cx, cy)
                                    )
                                }
                            }
                        }
                    }
                }

                // STEP 6: PICK LAYOUT
                6 -> {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Pick a Controller Layout",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            profiles.forEachIndexed { idx, prof ->
                                val selected = idx == activeProfileIndex
                                val previewIcon = when (prof.id) {
                                    "fps" -> R.drawable.btn_r2
                                    "racing" -> R.drawable.stick_base
                                    else -> R.drawable.btn_cross
                                }
                                Row(
                                    modifier = Modifier
                                        .weight(1f)
                                        .background(
                                            if (selected) Color(0xFF3B2A8F) else Color(0xFF070A14),
                                            RoundedCornerShape(12.dp)
                                        )
                                        .border(
                                            1.dp,
                                            if (selected) Color(0xFF22D3EE) else Color(0xFF1B2142),
                                            RoundedCornerShape(12.dp)
                                        )
                                        .clickable { onSelectProfileIndex(idx) }
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Image(
                                        painter = painterResource(id = previewIcon),
                                        contentDescription = prof.name,
                                        modifier = Modifier.size(28.dp)
                                    )
                                    Text(
                                        text = prof.name,
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Button(
                                onClick = {
                                    onSendTestButtonTap(ControllerState.BTN_CROSS)
                                    buttonTapFeedback = "PC response: Cross (0x0001) received"
                                }
                            ) {
                                Text("Press a button to test it")
                            }

                            if (buttonTapFeedback != null) {
                                Text(
                                    text = buttonTapFeedback!!,
                                    color = Color(0xFF34D399),
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                    }
                }

                // STEP 7: DONE
                7 -> {
                    val activeProf = profiles.getOrElse(activeProfileIndex) { profiles.first() }
                    val effectiveRtt = measuredTestRttMs ?: liveRttMs.takeIf { it > 0f }
                    val displayRtt = if (effectiveRtt != null) "${"%.2f".format(effectiveRtt)} ms" else "—"
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Setup Complete",
                            color = Color.White,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFF070A14), RoundedCornerShape(12.dp))
                                .border(1.dp, Color(0xFF1B2142), RoundedCornerShape(12.dp))
                                .padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Connection: ${connChoice.label}", color = Color.White, fontSize = 12.sp)
                                Text("Latency: $displayRtt", color = Color(0xFF34D399), fontSize = 12.sp)
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    "Gyro: ${if (gyroConfig.enabled) "On (${"%.1f".format(gyroConfig.sensitivity)}x)" else "Off"}",
                                    color = Color(0xFF22D3EE),
                                    fontSize = 12.sp
                                )
                                Text("Profile: ${activeProf.name}", color = Color.White, fontSize = 12.sp)
                            }
                        }
                        Button(
                            onClick = {
                                applyConnectionSettings()
                                prefs.edit()
                                    .putBoolean(KEY_SETUP_COMPLETED, true)
                                    .putInt(KEY_SETUP_STEP, 1)
                                    .apply()
                                onFinishSetup()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("Start", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }
                    }
                }
            }
        }

        // BOTTOM BAR: Back, Skip, and Next on EVERY step
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(
                onClick = { if (currentStep > 1) goToStep(currentStep - 1) },
                enabled = currentStep > 1
            ) {
                Text("Back")
            }

            TextButton(
                onClick = {
                    if (currentStep == 5) {
                        // Skip leaves safe gyro defaults
                        onUpdateGyroConfig(GyroConfig(enabled = true, sensitivity = 1.6f))
                    }
                    if (currentStep < 7) {
                        goToStep(currentStep + 1)
                    } else {
                        prefs.edit()
                            .putBoolean(KEY_SETUP_COMPLETED, true)
                            .putInt(KEY_SETUP_STEP, 1)
                            .apply()
                        onFinishSetup()
                    }
                }
            ) {
                Text("Skip", color = Color(0xFF94A3B8))
            }

            Button(
                onClick = {
                    if (currentStep == 3) applyConnectionSettings()
                    if (currentStep < 7) {
                        goToStep(currentStep + 1)
                    } else {
                        applyConnectionSettings()
                        prefs.edit()
                            .putBoolean(KEY_SETUP_COMPLETED, true)
                            .putInt(KEY_SETUP_STEP, 1)
                            .apply()
                        onFinishSetup()
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0E7490))
            ) {
                Text(if (currentStep < 7) "Next" else "Start")
            }
        }
    }

    if (showCameraScannerDialog) {
        QrScannerDialog(
            onDismiss = { showCameraScannerDialog = false },
            onPaired = { info ->
                ipDraft = info.ip
                portDraft = info.port.toString()
                tokenDraft = info.token
                qrScanError = null
                qrScanStatus = "Paired with ${info.ip}:${info.port}"
                showCameraScannerDialog = false
                onApplyEndpoint(
                    info.ip,
                    info.port,
                    info.token,
                    sendRateHz,
                    connChoice != WizardConnectionChoice.WIFI
                )
            }
        )
    }
}
