import receiverPyRaw from '../../desktop app/ds4_udp_receiver.py?raw';
import fakeSenderPyRaw from '../../desktop app/fake_phone_sender.py?raw';
import trayAppPyRaw from '../../desktop app/ds4_tray_app.py?raw';
import automatedTestsPyRaw from '../../desktop app/automated_test_suite.py?raw';
import pyinstallerSpecRaw from '../../desktop app/ds4_bridge.spec?raw';
import buildInstallerBatRaw from '../../desktop app/build_installer.bat?raw';
import requirementsTxtRaw from '../../desktop app/requirements.txt?raw';
import controllerStateKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/ControllerState.kt?raw';
import gyroProcessorKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/GyroProcessor.kt?raw';
import udpSenderThreadKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/UdpSenderThread.kt?raw';
import layoutProfileKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/LayoutProfile.kt?raw';
import hapticsRumbleKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/HapticsAndRumbleManager.kt?raw';
import startScreenKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/StartScreen.kt?raw';
import gameplayScreenKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/GameplayScreen.kt?raw';
import mainActivityKtRaw from '../../mobile app/app/src/main/java/com/ds4bridge/controller/MainActivity.kt?raw';
import drawableAssetsMdRaw from '../../mobile app/DRAWABLE_ASSETS.md?raw';
import manifestXmlRaw from '../../mobile app/app/src/main/AndroidManifest.xml?raw';
import buildGradleKtsRaw from '../../mobile app/app/build.gradle.kts?raw';

export interface SourceFileEntry {
  id: string;
  path: string;
  filename: string;
  category: 'Windows Python (ViGEmBus)' | 'Android Kotlin + Compose';
  language: 'python' | 'kotlin' | 'xml' | 'text';
  summary: string;
  content: string;
}

export const SOURCE_FILES: SourceFileEntry[] = [
  {
    id: 'gameplay_screen_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/GameplayScreen.kt',
    filename: 'GameplayScreen.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Pure fullscreen immersive Gameplay Screen: loads all 24 controls via `painterResource(R.drawable.*)`; pressed state scales to 0.92x & lowers alpha; single top-right gear opens the 40% slide-in Settings Panel while releasing sticks/buttons to neutral.',
    content: gameplayScreenKtRaw,
  },
  {
    id: 'start_screen_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/StartScreen.kt',
    filename: 'StartScreen.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Pre-gameplay Start Screen with 4 readable tabs (Connect & Transport, Layout & Profiles, Gyro & Calibration, Rumble & Haptics), `logo_app.png`, `ic_badge_usb.png`/`ic_badge_wifi.png`, live RTT, and big START GAMEPLAY button.',
    content: startScreenKtRaw,
  },
  {
    id: 'drawable_assets_md',
    path: 'mobile app/DRAWABLE_ASSETS.md',
    filename: 'DRAWABLE_ASSETS.md',
    category: 'Android Kotlin + Compose',
    language: 'text',
    summary:
      'Complete manifest of all 24 PNG image files in `mobile app/app/src/main/res/drawable-xxhdpi/` (`btn_cross.png`, `stick_base.png`, `stick_cap.png`, `ic_settings.png`, `logo_app.png`, `ic_badge_usb.png`, `ic_badge_wifi.png`, etc.).',
    content: drawableAssetsMdRaw,
  },
  {
    id: 'ds4_tray_app',
    path: 'desktop app/ds4_tray_app.py',
    filename: 'ds4_tray_app.py',
    category: 'Windows Python (ViGEmBus)',
    language: 'python',
    summary:
      'Windows System Tray app (pystray + Tkinter GUI) with USB/Wi-Fi transport badge, QR code, live input visualizer, rolling RTT latency graph, rumble capture, and Start-with-Windows registry toggle.',
    content: trayAppPyRaw,
  },
  {
    id: 'ds4_udp_receiver',
    path: 'desktop app/ds4_udp_receiver.py',
    filename: 'ds4_udp_receiver.py',
    category: 'Windows Python (ViGEmBus)',
    language: 'python',
    summary:
      'Virtual DualShock 4 via vgamepad (ViGEmBus), automatic `adb reverse` USB tunnel detector, 48-byte UDP/TCP receiver, 16-byte `<IQBBBB` Rumble + RTT echo sender, and `--test` mode.',
    content: receiverPyRaw,
  },
  {
    id: 'automated_test_suite',
    path: 'desktop app/automated_test_suite.py',
    filename: 'automated_test_suite.py',
    category: 'Windows Python (ViGEmBus)',
    language: 'python',
    summary:
      'Automated hot-path CPU profiler (~2 µs/pkt), USB TCP vs Wi-Fi UDP round-trip latency benchmark, 10% packet loss + OOO/stale filter verifier, and Wi-Fi drop reconnect watchdog test.',
    content: automatedTestsPyRaw,
  },
  {
    id: 'fake_phone_sender',
    path: 'desktop app/fake_phone_sender.py',
    filename: 'fake_phone_sender.py',
    category: 'Windows Python (ViGEmBus)',
    language: 'python',
    summary:
      '120Hz synthetic phone UDP transmitter with spin-assisted sub-millisecond frame pacing, optional out-of-order/stale fault injection, and real-time latency/p99 jitter stats.',
    content: fakeSenderPyRaw,
  },
  {
    id: 'pyinstaller_spec',
    path: 'desktop app/ds4_bridge.spec',
    filename: 'ds4_bridge.spec',
    category: 'Windows Python (ViGEmBus)',
    language: 'python',
    summary:
      'PyInstaller single-executable spec bundling `vgamepad` ViGEmClient DLLs into `dist/DS4Bridge120Hz.exe` with console=False for silent system tray execution.',
    content: pyinstallerSpecRaw,
  },
  {
    id: 'build_installer_bat',
    path: 'desktop app/build_installer.bat',
    filename: 'build_installer.bat',
    category: 'Windows Python (ViGEmBus)',
    language: 'text',
    summary:
      'One-click Windows build script that runs `automated_test_suite.py` and packages `dist/DS4Bridge120Hz.exe` via PyInstaller.',
    content: buildInstallerBatRaw,
  },
  {
    id: 'requirements_txt',
    path: 'desktop app/requirements.txt',
    filename: 'requirements.txt',
    category: 'Windows Python (ViGEmBus)',
    language: 'text',
    summary: 'Python dependencies for Windows ViGEmBus DualShock 4 emulation and terminal QR pairing.',
    content: requirementsTxtRaw,
  },
  {
    id: 'layout_profile_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/LayoutProfile.kt',
    filename: 'LayoutProfile.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Edit Mode layout model (`normX`, `normY`, `scale`, `opacity`, `Ds4ControlTarget` button/axis assignment) + JSON profile import/export with built-in "Default DS4", "FPS", and "Racing" presets.',
    content: layoutProfileKtRaw,
  },
  {
    id: 'haptics_rumble_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/HapticsAndRumbleManager.kt',
    filename: 'HapticsAndRumbleManager.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Plays continuous PC DualShock 4 `largeMotor` + `smallMotor` rumble via Android `VibrationEffect` and optional crisp haptic tap on button presses.',
    content: hapticsRumbleKtRaw,
  },
  {
    id: 'controller_state_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/ControllerState.kt',
    filename: 'ControllerState.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Single immutable `ControllerState` data class and zero-allocation Little-Endian `ByteBuffer` serializer matching `<IQHhhhhBBffffff` (48 bytes).',
    content: controllerStateKtRaw,
  },
  {
    id: 'gyro_processor_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/GyroProcessor.kt',
    filename: 'GyroProcessor.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Dedicated high-priority `HandlerThread` reading `SensorManager.SENSOR_DELAY_FASTEST`, implementing stationary drift calibration, sensitivity, X/Y axis invert, radial deadzone, EMA smoothing, and hold-button gating mapped to the right stick.',
    content: gyroProcessorKtRaw,
  },
  {
    id: 'udp_sender_thread_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/UdpSenderThread.kt',
    filename: 'UdpSenderThread.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Dual-transport 120Hz sender thread: auto-detects `adb reverse` USB tunnel (`127.0.0.1:26761`) with zero manual IP entry, falls back to Wi-Fi UDP, measures RTT for each, and parses 16-byte rumble packets.',
    content: udpSenderThreadKtRaw,
  },
  {
    id: 'main_activity_kt',
    path: 'mobile app/app/src/main/java/com/ds4bridge/controller/MainActivity.kt',
    filename: 'MainActivity.kt',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary:
      'Immersive fullscreen host (`FLAG_KEEP_SCREEN_ON`, hidden system bars) orchestrating `StartScreen` and `GameplayScreen` while keeping `UdpSenderThread` and `GyroProcessor` untouched.',
    content: mainActivityKtRaw,
  },
  {
    id: 'android_manifest_xml',
    path: 'mobile app/app/src/main/AndroidManifest.xml',
    filename: 'AndroidManifest.xml',
    category: 'Android Kotlin + Compose',
    language: 'xml',
    summary:
      'Configures `sensorLandscape` fullscreen orientation, `HIGH_SAMPLING_RATE_SENSORS` for 200Hz+ gyro, `INTERNET`, and `distinct` multi-touch hardware requirements.',
    content: manifestXmlRaw,
  },
  {
    id: 'build_gradle_kts',
    path: 'mobile app/app/build.gradle.kts',
    filename: 'build.gradle.kts',
    category: 'Android Kotlin + Compose',
    language: 'kotlin',
    summary: 'Android Gradle configuration with Jetpack Compose BOM, CameraX, and ML Kit Barcode Scanning for QR pairing.',
    content: buildGradleKtsRaw,
  },
];
