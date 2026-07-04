plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.smsgateway.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.smsgateway.app"
        minSdk = 29
        targetSdk = 34
        // Bumped from the original 1 (v1.0). Increment on every release.
        versionCode = 4
        versionName = "1.3"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    // Embedded HTTP server used by the (optional) legacy LAN push mode.
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    // Poll loop for pull mode.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
