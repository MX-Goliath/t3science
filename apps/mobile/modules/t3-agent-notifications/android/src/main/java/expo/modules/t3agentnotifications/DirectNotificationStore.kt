package expo.modules.t3agentnotifications

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.IOException
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class DirectNotificationStore(context: Context) {
  private val file = AtomicFile(File(context.noBackupFilesDir, "direct-notifications"))

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(
        KeyGenParameterSpec.Builder(
          KEY,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()
      )
    }.generateKey()
  }

  fun write(value: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val bytes =
      byteArrayOf(cipher.iv.size.toByte()) + cipher.iv +
        cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val output = file.startWrite()
    try {
      output.write(bytes)
      file.finishWrite(output)
    } catch (error: IOException) {
      file.failWrite(output)
      throw error
    }
  }

  fun read(): String? {
    if (!file.baseFile.exists()) return null
    val bytes = file.readFully()
    val ivSize = bytes[0].toInt()
    require(ivSize in 12..16 && bytes.size > ivSize + 1)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, ivSize + 1)))
    return cipher.doFinal(bytes.copyOfRange(ivSize + 1, bytes.size)).toString(Charsets.UTF_8)
  }

  fun clear() = file.delete()

  companion object {
    private const val KEY = "t3-direct-notifications"
  }
}
