# T3 Science releases

T3 Science distributes stable releases through the public
[MX-Goliath/t3science GitHub repository](https://github.com/MX-Goliath/t3science/releases).
The workflow is [release-science.yml](../../.github/workflows/release-science.yml).
It builds the commit selected when dispatching it. Only `workflow_dispatch` starts
it; pushes, tags and schedules do not. It creates a draft, which must then be
published by hand.

## One-time Android signing setup

Configure these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                    | Value                                              |
| ------------------------- | -------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of the persistent release keystore |
| `ANDROID_STORE_PASSWORD`  | Keystore password                                  |
| `ANDROID_KEY_ALIAS`       | Signing key alias                                  |
| `ANDROID_KEY_PASSWORD`    | Signing key password                               |

If an APK is already distributed, use its original signing key. Android refuses
an update signed by a different key. If previous APKs used a development key,
install the first release APK manually; changing keys requires uninstalling the
old app, which removes its local data.

For a new signing identity, create and back up a keystore outside this repository:

```sh
keytool -genkeypair -v -keystore /secure/path/t3science-release.jks \
  -alias t3science -keyalg RSA -keysize 4096 -validity 10000
base64 -w 0 /secure/path/t3science-release.jks > /secure/path/t3science-release.base64
```

Enter passwords in the keytool prompts. Upload the base64 file contents as
`ANDROID_KEYSTORE_BASE64` and save the other three secrets. Keep the keystore
and its passwords: every future APK must use them. The workflow fails before
building if a required secret is missing. It never falls back to a debug key.
No Expo account or OTA server is required for Android APK updates.

## Independent platform builds

**Actions → Build T3 Science Windows → Run workflow** builds the NSIS installer
and portable EXE. Supply only the stable version; no Android secrets or version
code are needed. Download `windows-release` from the completed run, including
its Windows update manifests.

**Actions → Build T3 Science Android → Run workflow** builds and verifies the
signed universal APK. Supply the stable version and Android version code, with
the signing secrets configured above. Download `android-release`, containing
the APK and `android-update.json`.

These workflows run independently and only on manual dispatch or when called
by the full release workflow. They do not create or publish a GitHub release.
The full release calls these same builds and waits for their artifacts before
creating its draft.

## Build and publish

1. Commit and push the configuration to the repository's default branch so the
   workflow appears in Actions.
2. Open **Actions → Release T3 Science → Run workflow**. Select the branch or
   commit to ship. Enter a stable version without `v`, for example `2.2.1`, and
   an Android version code, for example `2002001`. Both must exceed previous
   releases; an Android version code is an integer at most `2100000000`.
3. Wait for checks and all builds. The workflow creates a draft named
   `T3 Science <version>` with tag `v<version>` pointing at the selected commit.
4. Download and smoke-test the draft's artifacts. Test an upgrade from the
   previous installed version on each platform, including retained connections
   and drafts. For Android, verify the keystore matches and confirm the system
   installer can update the previous APK.
5. Open the draft in **Releases**, review its notes, and manually publish it as
   the latest stable release. Do not mark it as a prerelease. Clients discover
   it only after publication.

The draft contains Linux x64 AppImage, Windows x64 NSIS installer and portable
EXE, and a universal Android APK. It also includes `latest.yml`,
`latest-linux.yml`, `latest-portable.yml`, blockmaps where generated, and
`android-update.json`. Keep the manifests and their exact referenced filenames
attached to the same release. The portable manifest references only the portable
EXE, so it cannot install the NSIS version by mistake.

This workflow publishes the app artifacts above. It does not publish npm
packages, hosted websites, standalone server archives, macOS builds, or Nightly
releases. Windows builds are unsigned unless a separate Windows signing setup
is added; Android release signing is mandatory.

## How updates apply

AppImage and Windows installer builds use electron-updater's GitHub provider.
Windows portable uses the latest release's separate portable manifest and
replaces its original EXE after exit. The directory containing that EXE must
be writable. If replacement fails, the old EXE remains and an adjacent
`.update-error.log` records the failure. All desktop variants retain the
existing update UI, progress, restart and deferred-install behavior.

Android checks the latest release on launch and after returning from a long
stay in the background. It downloads the APK automatically, verifies its
SHA-256, package name, version code and signing certificate, and stores it in
private app storage. On the next launch it opens Android's installer for that
APK. The first time, Android may ask to allow this app to install packages;
after granting that permission, installation continues. Android requires the
user to confirm installation. A cancelled install remains available on the
next launch or through the existing manual update action in **Settings → About**
(tap the version five times). Downloading never restarts an active session.

Development and preview mobile builds keep their existing update behavior.
