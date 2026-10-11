import java.net.URI

plugins {
    id("com.android.application")
}

val configuredWebUrl = providers.gradleProperty("SGB_WEB_APP_URL")
    .orElse("https://montes.onrender.com")
val configuredWebHost = configuredWebUrl.map { URI.create(it).host ?: "montes.onrender.com" }
val webBundleDirectory = rootProject.file("../frontend/dist")
val generatedBrandingResources = layout.buildDirectory.dir("generated/sgb-branding-resources")
val prepareBrandingResources by tasks.registering(Copy::class) {
    from(rootProject.file("../frontend/public/branding/logo-sgb-icon.png"))
    into(generatedBrandingResources.map { it.dir("drawable-nodpi") })
    rename { "ic_sgb_logo.png" }
}
val verifyBundledWebApp by tasks.registering {
    inputs.dir(webBundleDirectory)
    doLast {
        check(webBundleDirectory.resolve("index.html").isFile) {
            "Falta frontend/dist/index.html. Ejecuta npm ci y npm run build dentro de frontend."
        }
        check(webBundleDirectory.resolve("assets").listFiles()?.isNotEmpty() == true) {
            "La compilación web no contiene recursos en frontend/dist/assets."
        }
    }
}

android {
    namespace = "com.jdmedranda.sgb"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jdmedranda.sgb"
        minSdk = 26
        targetSdk = 35
        versionCode = 16
        versionName = "2.0.0-alpha.16"
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

    sourceSets.getByName("main") {
        assets.srcDir(webBundleDirectory)
        res.srcDir(generatedBrandingResources)
    }
}

tasks.named("preBuild").configure {
    dependsOn(prepareBrandingResources, verifyBundledWebApp)
}

dependencies {
    implementation("androidx.work:work-runtime:2.10.1")
}
