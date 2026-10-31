package expo.modules.t3appupdates

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.json.JSONObject

class T3AppUpdatesModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val directory get() = File(context.filesDir, "app-updates").apply { mkdirs() }
  private val pending get() = File(directory, "pending.apk")
  private var available: JSONObject? = null
  private var waitingForPermission = false

  override fun definition() = ModuleDefinition {
    Name("T3AppUpdates")

    AsyncFunction("check") { checkUpdate() }
    AsyncFunction("download") { downloadUpdate() }
    AsyncFunction("install") { installPending() }

    OnActivityEntersForeground {
      if (waitingForPermission && Build.VERSION.SDK_INT >= 26 && context.packageManager.canRequestPackageInstalls()) {
        waitingForPermission = false
        installPending()
      }
    }
  }

  private fun checkUpdate(): Boolean {
    val metadata = connection("$RELEASES/latest/download/android-update.json").let { connection ->
      try {
        if (connection.responseCode == 404) return false
        check(connection.responseCode == 200) {
          "Could not check for Android updates: HTTP ${connection.responseCode}"
        }
        connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
      } finally {
        connection.disconnect()
      }
    }
    require(metadata.getString("packageName") == context.packageName) { "Update belongs to a different application." }
    require(metadata.getString("url").startsWith("$RELEASES/download/")) { "Unexpected Android update URL." }
    require(metadata.getString("sha256").matches(Regex("[a-f0-9]{64}"))) { "Invalid Android update checksum." }
    available = metadata
    return metadata.getLong("versionCode") > androidVersionCode(installed())
  }

  private fun downloadUpdate(): Boolean {
    val metadata = requireNotNull(available) { "Check for an update before downloading." }
    if (pending.exists()) {
      val saved = runCatching { validate(pending) }.getOrNull()
      if (saved != null && androidVersionCode(saved) == metadata.getLong("versionCode")) return true
    }
    val temporary = File(directory, "download.apk")
    return try {
      val download = connection(metadata.getString("url"))
      try {
        check(download.responseCode == 200) { "Could not download Android update: HTTP ${download.responseCode}" }
        download.inputStream.use { input -> temporary.outputStream().use { input.copyTo(it) } }
      } finally {
        download.disconnect()
      }
      val digest = MessageDigest.getInstance("SHA-256")
      temporary.inputStream().use { input ->
        val buffer = ByteArray(65536)
        var count = input.read(buffer)
        while (count != -1) {
          digest.update(buffer, 0, count)
          count = input.read(buffer)
        }
      }
      check(digest.digest().joinToString("") { "%02x".format(it) } == metadata.getString("sha256")) {
        "Android update checksum does not match."
      }
      val archive = validate(temporary)
      check(androidVersionCode(archive) == metadata.getLong("versionCode")) {
        "Android update version does not match."
      }
      check(temporary.renameTo(pending)) { "Could not save Android update." }
      true
    } finally {
      temporary.delete()
    }
  }

  private fun installed() = context.packageManager.getPackageInfo(context.packageName, signatureFlags())

  private fun signatureFlags() =
    if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

  private fun validate(file: File): PackageInfo {
    val archive = requireNotNull(context.packageManager.getPackageArchiveInfo(file.path, signatureFlags())) {
      "Invalid Android update APK."
    }
    verifyAndroidUpdate(archive, installed())
    return archive
  }

  private fun installPending(): Boolean {
    if (!pending.exists()) return false
    val archive = context.packageManager.getPackageArchiveInfo(pending.path, 0)
    if (archive == null || androidVersionCode(archive) <= androidVersionCode(installed())) {
      pending.delete()
      return false
    }
    validate(pending)
    if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
      waitingForPermission = true
      val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(settings)
      return false
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.appupdates", pending)
    val install = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(install)
    return true
  }

  private fun connection(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
    connectTimeout = 30000
    readTimeout = 60000
    setRequestProperty("User-Agent", "T3Science-Android-Updater")
  }

  companion object {
    private const val RELEASES = "https://github.com/MX-Goliath/t3science/releases"
  }
}
