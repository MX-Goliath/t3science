# Install T3 Code

T3 Code is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the T3 Code server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

```bash
npx t3@latest
```

This starts the T3 Code server on your machine and opens the local web app. Use
`npx t3@latest --help` for the full CLI reference.

## Desktop App

Desktop artifacts built from this repository are branded **T3 Science**. They use a separate
application identity and `~/.t3science` state directory, so they can run alongside an installed
T3 Code release. On Linux, `vp run dist:desktop:linux` creates
`release/T3-Science-<version>-<arch>.AppImage`; local T3 Science builds do not use the upstream T3
Code auto-update feed.

Download the latest release from
[GitHub Releases](https://github.com/pingdotgg/t3code/releases), or install from a package
registry.

Windows:

```bash
winget install T3Tools.T3Code
```

macOS:

```bash
brew install --cask t3-code
```

Arch Linux:

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

## Providers

T3 Code drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider    | CLI                                                                    | Default binary | Log in with           |
| ----------- | ---------------------------------------------------------------------- | -------------- | --------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                   | `codex`        | `codex login`         |
| Claude      | [Claude Code](https://claude.com/product/claude-code)                  | `claude`       | `claude auth login`   |
| Cursor      | [Cursor CLI](https://cursor.com/cli)                                   | `cursor-agent` | `agent login`         |
| Grok Build  | [Grok Build CLI](https://x.ai/cli)                                     | `grok`         | `grok login`          |
| Antigravity | [Antigravity CLI](https://antigravity.google/docs/cli-getting-started) | `agy`          | Run `agy`             |
| OpenCode    | [OpenCode](https://opencode.ai)                                        | `opencode`     | `opencode auth login` |
| Pi          | [Pi](https://pi.dev)                                                   | `pi`           | Run `pi`              |

Codex and Claude are on by default. Cursor, Grok Build, and OpenCode are off by default; turn
them on in **Settings** → the provider's card when you want to use them.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the T3 Code server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For provider-specific setup, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [Antigravity](./providers-antigravity.md), and
[Pi](./providers-pi.md).

### Switching Providers In An Existing Chat

Select another provider driver from the model picker while the chat is open. T3 Code starts a
fresh native session for that provider and sends the conversation history as context, so the
provider-specific session state is not shared. If the previous provider compacted the context,
messages before that boundary are omitted. T3 Code sends the provider's compaction summary when it
is available; otherwise it sends an explicit compaction-boundary marker instead of replaying the
older messages.

## Next Steps

- [Permission modes](./permission-modes.md): how much T3 Code asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping T3 Code in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
- [Desktop tray and startup](./desktop-tray.md): Windows and Linux tray behavior and launch at login
