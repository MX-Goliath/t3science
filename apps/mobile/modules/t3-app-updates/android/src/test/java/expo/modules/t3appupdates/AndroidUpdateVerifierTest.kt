package expo.modules.t3appupdates

import android.content.pm.PackageInfo
import android.content.pm.Signature
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [27], manifest = Config.NONE)
class AndroidUpdateVerifierTest {
  private fun apk(version: Int, name: String = "com.t3tools.t3science", key: String = "aabb") = PackageInfo().apply {
    packageName = name
    versionCode = version
    signatures = arrayOf(Signature(key))
  }

  @Test
  fun acceptsOnlyANewerApkForTheSamePackageAndSigningKey() {
    val current = apk(10)
    verifyAndroidUpdate(apk(11), current)
    val invalidApks = listOf(
      apk(10),
      apk(9),
      apk(11, name = "com.example.other"),
      apk(11, key = "ccdd"),
      apk(11).apply { signatures = emptyArray() },
    )
    for (invalid in invalidApks) {
      assertThrows(IllegalArgumentException::class.java) { verifyAndroidUpdate(invalid, current) }
    }
  }
}
