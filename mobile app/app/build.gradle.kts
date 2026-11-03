plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.ds4bridge.controller"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ds4bridge.controller"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    // Release signing is read from gradle.properties / environment, never committed:
    //   DS4_KEYSTORE_FILE, DS4_KEYSTORE_PASSWORD, DS4_KEY_ALIAS, DS4_KEY_PASSWORD
    signingConfigs {
        create("release") {
            val ks = (project.findProperty("DS4_KEYSTORE_FILE") as String?) ?: System.getenv("DS4_KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = (project.findProperty("DS4_KEYSTORE_PASSWORD") as String?) ?: System.getenv("DS4_KEYSTORE_PASSWORD")
                keyAlias = (project.findProperty("DS4_KEY_ALIAS") as String?) ?: System.getenv("DS4_KEY_ALIAS")
                keyPassword = (project.findProperty("DS4_KEY_PASSWORD") as String?) ?: System.getenv("DS4_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val cfg = signingConfigs.getByName("release")
            if (cfg.storeFile != null) signingConfig = cfg // unsigned release APK when no keystore is configured
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")

    // CameraX + ML Kit Barcode Scanning for QR Code IP:Port Pairing
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}
