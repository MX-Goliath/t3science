package expo.modules.t3appupdates

import android.content.pm.PackageInfo
import android.os.Build

internal fun androidVersionCode(info: PackageInfo): Long =
  if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

private fun signers(info: PackageInfo): Set<String> {
  val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
  return requireNotNull(signatures) { "Android update has no signing certificate." }.map { it.toCharsString() }.toSet()
}

internal fun verifyAndroidUpdate(archive: PackageInfo, current: PackageInfo) {
  require(archive.packageName == current.packageName) { "Android update has a different package name." }
  require(androidVersionCode(archive) > androidVersionCode(current)) { "Android update is not newer than this app." }
  val currentSigners = signers(current)
  require(currentSigners.isNotEmpty() && signers(archive) == currentSigners) {
    "Android update was signed with a different key."
  }
}
