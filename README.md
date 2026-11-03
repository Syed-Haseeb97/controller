# DS4 Bridge 120Hz

DS4 Bridge 120Hz turns an Android phone into a low-latency 120Hz virtual DualShock 4 controller for PC gaming over Wi-Fi (UDP) or USB (ADB reverse port forwarding).

## Project Layout

- **`desktop app/`**: Python ViGEmBus receiver + system tray app + automated test suite + PyInstaller packaging spec. Emulates a hardware Sony DualShock 4 controller via ViGEmBus.
- **`mobile app/`**: Native Android app written in Kotlin and Jetpack Compose. Captures multi-touch controls, sticks, buttons, and high-frequency gyroscope data, streaming UDP packets at up to 120Hz to the PC server.
- **`web simulator/`**: React + Vite + TypeScript web application providing an interactive controller surface, protocol packet visualizer, setup wizard, and source explorer.
- **`tools/`**: Asset downloader (`fetch_assets.py`) and cross-language protocol compliance test harness (`protocol_tests.mjs`).
- **`TESTING.md`**: Comprehensive test plan covering unit tests, build validation, simulated network traffic, and real hardware testing procedures.
- **`ASSETS_LICENSE.md`**: Asset licensing and attribution for controller button glyphs and graphical elements.
