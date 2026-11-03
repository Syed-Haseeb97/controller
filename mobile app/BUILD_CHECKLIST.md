# Android build checklist

1. Install Android Studio (Koala or newer) with SDK Platform 35 and JDK 17 (bundled JBR is fine).
2. File > Open > select the `mobile app` folder. If `gradle/wrapper/gradle-wrapper.jar` is missing,
   Android Studio regenerates it on sync (or run `gradle wrapper` once).
3. Sync Gradle, then Build > Make Project. Fix nothing: the project must build with zero errors.
4. Debug on a phone: enable Developer options + USB debugging, plug in, press Run.
5. Release APK: set DS4_KEYSTORE_FILE, DS4_KEYSTORE_PASSWORD, DS4_KEY_ALIAS, DS4_KEY_PASSWORD (gradle.properties
   in your home `.gradle` folder, or environment), then `./gradlew assembleRelease`
   (output: `app/build/outputs/apk/release/`). Without them the release APK is unsigned.
6. Smoke test (see top-level TESTING.md): pair by QR, Test connection (shows measured RTT), start gameplay,
   verify buttons, sticks, analog triggers, gyro, rumble, USB/Wi-Fi switching, background the app (PC must
   show a neutral controller within ~0.5 s).
