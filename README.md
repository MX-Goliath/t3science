# T3 Science

This project is a fork of [T3 Code](https://github.com/pingdotgg/t3code) that adds functionality focused on supporting scientific research workflows. The core codebase is based on the original project, and all existing coding functionality has been preserved.

## Changes Compared to the Original T3 Code

- Added opt-in portable local conversations stored in each project's `.t3/conversations` directory, including attachments and Actions, so projects can be moved between devices and conversations continued from the project root.
- Added display of the remaining 5-hour and weekly usage limits for Codex, Claude Code, and Antigravity.
- Added the ability to pin chats and preserve their order across web, desktop, and mobile clients, with pinned chats also supported inside projects in the legacy sidebar.
- Added an opt-in web interface for using ChatGPT, Claude, Grok, and Perplexity without running those tasks through a provider CLI, making it possible to run tasks such as Deep Research separately. By default, downloaded files are saved to the most recently opened project directory, with a save-location dialog opening inside that project folder for more convenient document export.
- Added the ability to define custom AI prompts in Actions for frequently repeated tasks.
- Added opt-in general chats for questions and conversations not connected to any project.
- Added sorting threads by recent activity, so conversations with new messages or turns move to the top.
- Added the ability to switch providers within an existing chat while carrying its conversation context into a new provider session.
- Added scheduled message sending at a chosen time or after usage limits reset, plus the ability to queue messages until the current or another agent finishes its turn.
- Added handling for unavailable project folders: affected chats remain readable but cannot send messages, and are restored automatically when the folder becomes available again.
- Added Windows and Linux desktop tray support, including keeping the app running in the tray, starting in the tray, and launching at login.
- Added Antigravity provider support through the `agy` headless CLI, including model discovery, reasoning levels, permissions, image attachments, and session continuation.
- Added progress rings for agent plans in the sidebar, with unfinished plans carried across follow-up turns.
- Added OpenCode streaming support with separate controls for reasoning effort and agent selection, as well as token usage and context-window tracking.
- Added animated desktop pets, with separate companions assignable to provider instances and animations shown in the draft hero and after turns finish.

# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions and configured models on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Pi. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Pi. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Pi: install [Pi](https://pi.dev) and configure a model by running `pi`

### Try it out (install-free)

The easiest way to test T3 Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx t3@latest
```

This will launch T3 Code's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx t3@latest --help` for the full CLI reference.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Customize a project icon](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Desktop tray and startup](./docs/user/desktop-tray.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
