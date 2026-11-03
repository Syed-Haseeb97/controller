# Real-hardware test order

Do the steps in order; stop at the first failure. Need: Windows 10/11 PC, Android 8+ phone, USB cable, same Wi-Fi.

**0. PC prerequisites** - install ViGEmBus, `pip install vgamepad pillow qrcode`, and Android platform-tools (`adb`).
Run `python pc_server/automated_test_suite.py` -> all 13 tests PASS.

**1. Build** - create the wrapper JAR (see `android_app/README.md`), then `cd android_app && ./gradlew assembleDebug`.
Pass: `BUILD SUCCESSFUL`, `app/build/outputs/apk/debug/app-debug.apk` exists.

**2. Install** - `adb install -r app/build/outputs/apk/debug/app-debug.apk`; launch the app.
Pass: app opens with real artwork (no text-label boxes), launcher icon shown.

**3. PC app + driver** - `python pc_server/ds4_tray_app.py`. Wizard driver step must turn green
("Virtual DualShock 4 created"). Open `joy.cpl`: exactly ONE "Wireless Controller". Click "Try again" 3 times: still one.

**4. Wi-Fi pairing** - phone and PC on the same network. In the phone wizard tap *Scan QR* and scan the PC QR
(`ds4udp://ip:port?token=...`). Run the wizard connection test.
Pass: success with a measured RTT and a 16-byte echo. Negative checks: edit one token character -> test fails;
press PC *Reset pairing* -> phone stops being accepted until it rescans.

**5. Inputs** - in `joy.cpl > Properties` press every on-screen button. Face buttons, D-pad, L1/R1, L3/R3, Share, Options
register. L2/R2 move the analog axes (and the digital L2/R2 buttons). **PS** and **Touchpad** each light only
their own special button (not Share/Options/L3/R3).

**6. USB** - enable USB debugging, plug in the cable, `adb devices` shows the phone. Switch to USB (or leave auto-USB on).
Pass: PC badge shows USB, the connection test shows < Wi-Fi RTT, inputs still work. Unplug -> app falls back to Wi-Fi.

**7. Gyro** - enable gyro aim, hold the activation button (default L2) and tilt: right stick moves only while held.
Check sensitivity, deadzone and invert in settings; tilt must not drift when the phone is still (recalibrate on a table).

**8. Rumble** - start a game or the PC test mode that sends rumble (or the wizard test). Phone vibrates; toggle
rumble off in settings -> no vibration. Button-tap haptics respect their own toggle.

**9. Latency** - open the PC dashboard graph for 2 minutes of continuous input. Record median Hz (target ~120) and RTT
for Wi-Fi and USB. Expected: USB ~1-3 ms, Wi-Fi 3-10 ms on 5 GHz. Note any gaps > 50 ms.

**10. Reconnect** - (a) turn phone Wi-Fi off/on, (b) kill and restart the PC app, (c) unplug/replug USB, (d) lock/unlock
phone. Pass: controller neutralizes within ~0.5 s of loss and resumes automatically (re-auth happens within ~1 s) with no re-pairing,
except after *Reset pairing*. Finally close and reopen the app: IP, port, token, gyro, haptics and layout profile must persist.

Record results (PASS/FAIL, RTT, Hz, notes) per step before reporting issues.
