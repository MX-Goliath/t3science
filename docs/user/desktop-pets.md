# Desktop pets

T3 Code Desktop can show a small animated OpenPets companion in the `Working` row. The companion stays inside the timeline, so it moves down with the row as new messages and tool activity appear.

This feature is available only in the Desktop app. Web and mobile clients continue to use the normal working indicator.

## Turn pets on

Open **Settings → General → Desktop pets** and turn on **Show pets**. The same section lists every installed pet and is where archives are imported and removed. There is no shared companion: which pet appears is decided per provider.

## Assign a pet to a provider

Open **Settings → Providers**, expand a provider instance, and use **Companion pet**. Every instance has its own assignment — built-in slots such as Codex and Claude, and each manually added provider instance. Pick **No pet** to keep the plain dots for that provider.

The section shows the assigned pet in a large preview with a menu for trying all nine animations.

While a turn runs, the `Working` row shows the pet assigned to the provider instance running it. The pet reacts to what the turn is doing: it runs while the agent works, waits while the agent asks a question or awaits your approval for a command, and reviews a checkpoint while a restore runs. When the turn finishes, the pet stays for a few seconds to celebrate a done turn, fail a broken one, or wave a stopped one, then the row goes away.

The Desktop app includes **Codex** and **Claude**. On first run they are assigned to the built-in Codex and Claude provider slots; every later change is yours to make.

## Import a pet

Use **Import ZIP** in the Desktop pets settings. The archive must contain exactly these two files, either at its root or inside one root folder:

- `pet.json`
- `spritesheet.webp`

The manifest must use a lowercase ID made of letters, digits, and hyphens. The spritesheet must use the standard OpenPets 8-by-9 frame grid. Imports are stored locally on the computer and remain available after restarting the app. An imported pet is not assigned to anything until you pick it for a provider.

The importer rejects unsafe paths, symlinks, encrypted archives, unsupported compression, extra files, oversized archives, and invalid spritesheets. Cancelling the file picker leaves the current settings unchanged.

## Remove a pet

Only user-imported pets can be removed. The built-in Codex and Claude entries are protected. Removing a pet clears it from every provider that used it, and those providers fall back to the plain working indicator.
