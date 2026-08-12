# Desktop pets

T3 Code Desktop can show a small animated OpenPets companion in the `Working` row. The companion stays inside the timeline, so it moves down with the row as new messages and tool activity appear.

This feature is available only in the Desktop app. Web and mobile clients continue to use the normal working indicator.

## Enable and choose a pet

Open **Settings → General → Desktop pets**. Turn on **Show pet**, then select an installed pet. The section also includes a large preview and a menu for trying all available animations.

The Desktop app includes **Codex Buddy** and **Claude**. Codex Buddy is enabled and selected by default.

## Import a pet

Use **Import ZIP** in the Desktop pets settings. The archive must contain exactly these two files, either at its root or inside one root folder:

- `pet.json`
- `spritesheet.webp`

The manifest must use a lowercase ID made of letters, digits, and hyphens. The spritesheet must use the standard OpenPets 8-by-9 frame grid. Imports are stored locally on the computer and remain available after restarting the app.

The importer rejects unsafe paths, symlinks, encrypted archives, unsupported compression, extra files, oversized archives, and invalid spritesheets. Cancelling the file picker leaves the current settings unchanged.

## Remove a pet

Only user-imported pets can be removed. The built-in Codex Buddy and Claude entries are protected. If the selected user pet is removed, the app chooses Codex Buddy, then Claude, then the first available pet.
