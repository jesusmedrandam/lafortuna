import java.net.URI

plugins {
    id("com.android.application")
}

val configuredWebUrl = providers.gradleProperty("SGB_WEB_APP_URL")
    .orElse("https://montes.onrender.com")
val configuredWebHost = configuredWebUrl.map { URI.create(it).host ?: "montes.onrender.com" }

android {
    namespace = "com.jdmedranda.sgb"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jdmedranda.sgb"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.0.0-alpha.1"
        buildConfigField("String", "WEB_APP_URL", "\"${configuredWebUrl.get()}\"")
        manifestPlaceholders["webAppHost"] = configuredWebHost.get()
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.work:work-runtime:2.10.1")
}
