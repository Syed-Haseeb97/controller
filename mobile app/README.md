# DS4 Bridge 120Hz - Android app

## Missing file: `gradle/wrapper/gradle-wrapper.jar`

The Gradle wrapper JAR is a binary and could not be included in this repository.
`gradlew`, `gradlew.bat` and `gradle/wrapper/gradle-wrapper.properties` (Gradle 8.10.2) are present,
but `./gradlew` will not run until the JAR exists. Create it with **either** option:

### Option A - Android Studio (easiest)
1. `File > Open...` and select this `mobile app/` folder.
2. Let the initial Gradle sync finish. Android Studio downloads Gradle 8.10.2 from
   `gradle-wrapper.properties` and regenerates `gradle/wrapper/gradle-wrapper.jar` for you.
   If sync is blocked, `File > Settings > Build > Gradle` and set "Use Gradle from: Wrapper".

### Option B - command line (needs any local Gradle >= 8.x, e.g. `brew install gradle`, `choco install gradle`, sdkman)
```bash
cd "mobile app"
gradle wrapper --gradle-version 8.10.2 --distribution-type bin
```
This writes `gradle/wrapper/gradle-wrapper.jar` and refreshes `gradlew` / `gradlew.bat`
(replacing the minimal scripts shipped here with the official ones). Then:
```bash
./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug
```
APK: `app/build/outputs/apk/debug/app-debug.apk`

Commit the generated JAR (`gradle-wrapper.jar`) so teammates do not repeat this step.

## Requirements
JDK 17, Android SDK 35 (installed via Android Studio's SDK Manager), a phone running Android 8.0+ (API 26).

## Artwork
Controller images are real CC0/MIT artwork installed by `python tools/fetch_assets.py`
(see `../ASSETS_LICENSE.md`). `USE_PLACEHOLDER_LABELS` in `LayoutProfile.kt` is `false`; set it to `true`
to draw labeled outlines over every image while debugging layouts.
