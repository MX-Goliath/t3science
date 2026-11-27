# Messages and context

Use the composer to send prompts, attach files, reference threads or pull requests, invoke skills, and steer or queue follow-ups.

## Limits and large pastes

- **Message length**: Up to 120,000 characters.
- **Large pastes**: Pasting 32 KiB+ of text (or any paste that would exceed the message limit) turns it into a text-file attachment so it doesn't bloat the prompt. Use `Cmd+Shift+V` (Apple) or `Ctrl+Shift+V` (Windows/Linux) to paste inline instead.

## Formatting

The composer renders Markdown live as you type and reveals raw markers when your cursor enters styled text. The agent receives the exact Markdown you typed.

- Disable live styling in **Settings → Chat → Rich text composer**.
- Standard Markdown triggers (`- `, `1. `, `- [ ] `, `> `, `# `, `---`, and ` ``` ` + Enter) create lists, quotes, headings, rules, and code blocks.
- In lists/quotes, `Shift+Enter` continues (or exits on an empty line), and `Tab` / `Shift+Tab` indents or outdents.
- In code blocks, `Enter` keeps indentation, `Tab` / `Shift+Tab` indents selected lines, and closing ` ``` ` + Enter (or two blank lines) exits the block.

## Attach files

Attach up to **100 files** per message:

- **Images**: Up to 10 MiB each, 80 MiB total per message. HEIC/HEIF photos are converted to JPEG, and oversized photos are resized automatically.
- **Other files (including videos)**: Up to 50 MiB each (subject to environment limits). Video attachments pass a file path; only [Antigravity](./providers-antigravity.md#skills-and-attachments) sends supported videos natively to Gemini models.

Enable **Settings → Science → Science** first.
On web and desktop, right-click an attachment thumbnail beside the composer and
choose **Pin attachment** to include it with every message in that chat. It stays
in the composer after sending and across restarts. Choose **Unpin attachment**
to send it just once more, or remove it to stop including it immediately.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the mobile photo
library; photos over the image limit are also resized to fit. On mobile, you can
also send files to T3 Code through another app's system share sheet.
On Android, you can also drag images from another app into the message input
in split screen.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Science controls

Enable **Settings → Science → Science** to turn on all Science composer controls,
the expanded queue, scheduled sends, pinned attachments and work panels available
on that client. This single switch is off by default. Turning it off restores the
standard interface and pauses scheduled messages. The setting is saved per client.

## Send while the agent is working

Choose your default follow-up behavior in **Settings → Chat → Follow-up behavior** (per client):

- **Queue**: Holds the message on the server for the next turn.
- **Steer**: Injects the message into the running turn (when supported by the agent).

Shortcuts while a turn is running:

- **Opposite action**: `Cmd+Enter` (macOS) or `Ctrl+Enter` (Windows/Linux) uses the non-default action. If your send shortcut already requires `Cmd/Ctrl+Enter`, add `Shift`. On mobile, long-press the send button or use `Cmd/Ctrl+Return` on a hardware keyboard.
- **Steer oldest queued message**: `Cmd+Shift+Enter` (macOS) or `Ctrl+Shift+Enter` (Windows/Linux) sends the first queued message as a steer without touching your current draft. Remap `thread.steerQueuedMessage` in **Settings → Keybindings**, or add a rule in your [keybindings file](./keybindings.md#edit-the-configuration-file) to trigger it on `mod+enter` when the composer is empty:

```json
{
  "key": "mod+enter",
  "command": "thread.steerQueuedMessage",
  "when": "composerFocus && turnRunning && composerEmpty"
}
```

- **Edit most recently queued message**: `Option+Up` (macOS) or `Alt+Up` (Windows/Linux) at the start of the composer (`thread.editQueuedMessage`).

Slash commands (such as `/compact` or `/context`) wait for the current turn to finish rather than steering into it. [Goal](#goals) commands are the exception.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments so you can preview them and queue messages offline. Uploads resume on reconnect, and drafts/queued messages survive app restarts and T3 Connect sign-out (restored when signing back into the same account).

## Custom models and defaults

- **Remembered defaults**: T3 Code remembers your last provider, model, and options for new threads. A project's configured model overrides this. Leaving reasoning level or service tier unset uses the provider's default.
- **Custom models**: Add unlisted models in **Settings → Providers → Models** (web and desktop; not supported for Antigravity, which uses its account catalog).
- **Rename a built-in model across all clients**: Add an entry in the server's `userdata/settings.json`:

```json
{
  "providerInstances": {
    "codex": {
      "driver": "codex",
      "config": { "customModels": [{ "slug": "gpt-5.5", "name": "Team GPT" }] }
    }
  }
}
```

## Quote an assistant response

- **Web and desktop**: Select text in an assistant message and click **Cite in composer**. Click the pencil on the chip to add or edit a comment; click the chip to jump back to the source.
- **Mobile**: Long-press an assistant response, select text, and tap **Cite**. Tap a quote chip to edit its comment, remove it, or jump to the source message.

Quoted text and comments count toward the message length limit and are preserved across copy/paste and [stashed prompts](#prompt-stash).

## Recall a sent prompt

Press `ArrowUp` in an empty composer to cycle backward through earlier prompts in the thread, and `ArrowDown` to move forward. Only prompt text is restored (not attachments or context chips). Editing a recalled prompt turns it into a normal draft.

## Suggested next prompt

Enable **Settings → Labs → Suggest next prompt** (web and desktop) to show a predicted next message in the empty composer after a Claude or Codex turn completes.

- Press `Tab` to accept or `Escape` to dismiss.
- Each suggestion uses one cached request against your plan's usage. Claude skips suggestions on the first turn and near usage limits.
- Codex requires CLI version 0.165+ (update in **Settings → Providers**). Open Claude threads pick up the setting after restarting.

## Edit an earlier prompt

On web and desktop, select **Edit from here** under a sent message to rewind the conversation to before that message and return it to the composer:

- **Revert and keep changes**: Rewinds the conversation only.
- **Revert files too**: Restores workspace files to the checkpoint before that message (including your own edits). Only available for worktree threads when no other thread or active session shares that directory.

Rewinding removes later messages from the active thread and provider history (requires provider rewind support), but cannot undo external actions or separate provider memory.

## Prompt stash

On web and desktop, press `Cmd+S` (macOS) or `Ctrl+S` (Windows/Linux) to stash the current draft and its attachments (wait for uploads to finish first). Press the same shortcut in an empty composer to restore the stash (or open the stash menu if you have multiple).

- Holds up to 100 prompts in browser storage; stashes are never auto-deleted.
- Stashes with uploaded files must be restored in their original environment. Uploads expire after 24 hours; use **Attach again** or remove expired files before sending.

## Voice input

Dictate into the composer with the microphone button or `mod+shift+d` (web and desktop). Audio stays on-device or goes only to an environment/provider you explicitly choose in **Settings → Voice**. See [Voice input](./voice-input.md) for setup, mobile dictation, and microphone priority.

## Queued messages

The send button follows **Settings → Chat → Follow-up behavior** while an agent
is working. Hold `Cmd` on macOS or `Ctrl` on Windows and Linux to use the other action.
With an empty draft, the button interrupts the running turn.
On web and desktop, the composer shows **Interrupt** while the agent is working and the draft is
empty. Adding text or attachments replaces it with a send button that shows your
[Follow-up behavior](#send-while-the-agent-is-working): a queue icon for Queue or a steer arrow for
Steer. Click it or press your send shortcut to use that action. Hold `Cmd` on macOS or `Ctrl` on
Windows and Linux to switch the button to the opposite action, then click, or use the opposite-action
shortcut described above.

- **Send now**: Injects it immediately into a running turn (or moves a slash command to the front of the queue).
- **Edit**: Opens the message and its attachments in the composer without losing your existing draft.
- **Remove**: Cancels the queued message.

Drag a queued message by its handle to change its place. On web and desktop, focus
the handle and press the arrow keys to move it. On mobile, use the handle or the
message menu's **Move up** and **Move down** actions.

If you stop the agent or the server restarts, queued messages keep their order and are held.
Press **Resume** in an empty composer to continue. For stopped runs and usage limits,
this uses the provider's native continuation without sending a new prompt. If the provider
does not support it, send a message to continue instead. If the original request never reached
the provider, Resume sends that request again.

Sending a new message also resumes the queue, unless it steers a turn that is already
running. You can edit or remove held messages without starting them.

The pencil on a queued message opens it in the composer for editing. The original message
stays in the queue until you save, and it is highlighted while you edit. The message's
attachments appear above the text with a remove control, and new images can be added the usual way.
The checkmark saves the queued message in place; **Cancel** next to it leaves it unchanged. Whatever
you had typed in the composer before starting the edit is restored afterwards. If the queued
message starts or is removed while you are editing, the edit ends: changed content moves into the
composer when it is empty, and is discarded otherwise.

## Commands and skills

Type `/` for commands or `$` for skills from the selected environment and provider.

The slash menu also includes skills unless you turn off **Settings → Chat →
Show skills in slash menu**, under Advanced. Only skills enabled for the provider are listed.

After you add or change skills, plugins, or MCP servers, use **Restart agent
session** in the command palette on web and desktop. The conversation continues,
and your next message starts the agent again with the new setup.

Provider commands must start the message to run. T3 Code commands such as
`/model` and skill mentions work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it.

Send `/clear` on its own, or pick it from the slash menu, to start a fresh session
in the same thread. Your next message goes to a new provider session that doesn't see the
earlier messages, and the thread marks where it began with **New session**.
Earlier messages and diffs stay in the thread. Dismiss the notice above the
composer to keep the current session instead.

On web and desktop, turn on **Settings → Science → Legacy → Context
window indicator (legacy)** to see context usage. The meter is off by default
and appears once the provider reports usage. Open it for usage details and
**Compact context** when the provider supports compaction.

On web and desktop, turn on **Context window** in **Settings → Appearance →
Thread details** to see context usage in the thread details card. It appears
once the provider reports usage.

Claude instances can also compact idle threads for you. See
[compact long conversations](./providers-claude.md#compact-long-conversations).

## Goals

With Codex, Claude, and OpenCode 2.2.5 or later, send `/goal` followed by what "done" means, for example
`/goal all tests in packages/api pass`. The agent keeps working across turns
until it judges the goal met. The thread shows **Goal** while it works. The goal
and its progress appear above the composer in Science mode and on mobile, and
at the end of the thread in the standard web and desktop interface.

- `/goal` shows the current goal; `/goal clear` removes it.
- Codex and OpenCode support `/goal pause` and `/goal resume` (stopping pauses the goal).
- On Claude, stopping ends the current turn but keeps the goal active for your next message.
- Sending a new goal or `/goal resume` while working interrupts the current turn unless queued; `/goal clear` and `/goal pause` interrupt only when the agent is actively working on the goal.

## Context in your message

Attached context—files, terminal excerpts, diff/file review comments, preview annotations, pull requests, and threads—appears as inline chips at your cursor. Click a chip to inspect or open its source; copy/paste and [Prompt stash](#prompt-stash) preserve chips across drafts.

- **Pull requests (`#`)**: On web and desktop, type `#` to browse recent PRs in the current repository (linked PRs appear first), type digits to match by number, or type a word to search by text.
- **Threads (`@`)**: Type `@` and part of a thread title to reference a thread on the same server (or on a linked machine when Linked environments is enabled). You can also drag threads from the sidebar onto the composer, or paste a copied thread link. The prompt carries only a reference—the agent reads the thread on demand. Dropping a thread from an unlinked environment attaches a snapshot transcript file instead.
- **Models (`@`)**: Type `@` and part of a model or provider name (e.g. `@opus` or `@opus:opencode`) to reference a model in your prompt (such as for delegation) without changing the thread's model.
- **Images vs. files**: Images keep a thumbnail shelf above the composer plus optional inline chips; files live only as inline chips (deleting the last chip removes the file).

## Attached files

Select any file chip in a draft or sent message to preview it (syntax-highlighted code/JSON, rendered/raw Markdown/HTML/CSV/TSV, audio playback, and ZIP folder browsing up to 50 MB). Large text files show a truncated preview—save the file to read it in full.

When a preview asks for a file password, enter it and select **Unlock**. T3 Code uses the password on your device. Web and desktop can unlock supported PDF, ZIP, Office, and OpenDocument files. The mobile app can unlock ZIP attachments, and Android can unlock PDFs. Ebooks protected by DRM need a compatible reader.

## Images and videos in messages

Select an image or video attachment or link to preview it.

- **Web and desktop**: Right-click media to save it or copy its path/URL.
- **Mobile**: Long-press a thumbnail and choose **Save or share**.

File links point to the file on the environment's machine, so moving or deleting the original breaks the preview—save a copy if you need to keep it.

## Files outside the workspace

Following an agent's file link to a file outside the workspace opens it read-only. External HTML files cannot load neighboring scripts, styles, or images.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

The file viewer recognizes images, HTML, and PDF files by their filename extension,
including filenames or folders containing `#` or `?`.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens a compatible installed file viewer.

## Science model presets

On web and desktop, in **Settings → Science**, enable Science and **Model presets**, then configure the six positions. Each preset saves a model, its provider, and its reasoning level where supported. Different positions can use different providers.

The model menu opens the preset bar by default. Choosing a model manually switches that chat to its usual model controls. Press Reset in the top-right corner of the menu to return to presets and restore the project’s default model and reasoning level. Other chats keep their own mode. Models must be available in the connected environment, and existing thread restrictions still apply.

## Schedule a message

Enable **Settings → Science → Science** on the client that will
send the message. It is off by default; disabling it pauses saved scheduled messages.

On web and desktop, right-click Send to schedule a message at a chosen time,
after the current agent finishes, or after another thread's agent finishes. Reset-time
scheduling uses the provider's reported allowance reset. Review or cancel the scheduled
message in the composer. Keep this client connected for a scheduled message to send.

On mobile, long-press Send in an existing thread and choose **Schedule send…**.
The message and its attachments stay on that phone. Keep T3 Science running and
connected; if you close it, the message sends after you reopen it. Tap the
scheduled message's time to send it now or cancel. Edit it with the pencil to
return it to the composer and choose a new time.

## Response streaming

Choose **Settings → Threads → Advanced → Response streaming** to show text as it arrives,
show finished paragraphs and code blocks, or wait for the full response. The
setting also applies to reasoning text and can be overridden per project.
On mobile, find the same choices under **Settings → Agent behavior**.
