import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release key comes from the environment (GitHub secrets in CI). It is never in the repo.
// Every APK must be signed with the same key, or it won't install over the old one.
val storeFile: String? = System.getenv("SIGNING_STORE_FILE")

android {
    namespace = "com.faizmuna.journal.widget"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.faizmuna.journal.widget"
        minSdk = 26
        targetSdk = 36
        // Must go up with every build, or Android refuses the update. CI passes the run number.
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1.0.$versionCode"
    }

    signingConfigs {
        if (storeFile != null) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (storeFile != null) signingConfigs.getByName("release") else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    // Receipt scanning (ScanActivity): Google's document scanner UI, run by Play services. It brings some AndroidX in
    // underneath; the app's own code still uses none.
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0")
}
