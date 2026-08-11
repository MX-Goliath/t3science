# Antigravity

T3 Code uses Antigravity CLI's headless mode, available in recent `agy` releases. Install and sign
in to `agy` on the machine running the T3 Code server, then select an Antigravity model from the
composer. The provider is marked **Early Access** while the headless interface is new.

## Setup

Install Antigravity CLI using the [official instructions][install], then launch it once to complete
sign-in:

```bash
agy
```

T3 Code discovers `agy` from the server's `PATH`. If it is installed elsewhere, set **Binary path**
on the Antigravity provider in **Settings → Providers**. The provider status reports the installed
version, authentication state, and models available to the signed-in account.

## VPN And Proxies

Antigravity turns use the network route of the machine running the T3 Code server, including a
system VPN. T3 Code launches `agy` as an external CLI rather than identifying it as the desktop app,
so per-application VPN routing treats it like a terminal launch.

For an environment-variable proxy, add variables such as `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`,
and `NO_PROXY` to the Antigravity instance in **Settings → Providers**. Restart the desktop server
after changing proxy variables inherited from the operating system.

## Sessions And Models

Each T3 Code thread starts an Antigravity conversation in the thread's workspace. Follow-up turns
resume that native conversation, including after a T3 Code server restart. You can switch to another
Antigravity model within the same thread.

The model picker exposes Antigravity's Low, Medium, and High reasoning-effort settings. Image
attachments are passed to the CLI as workspace-scoped `@path` references.

Antigravity reports its account-specific model catalog at runtime. You can also add a custom model
slug in the provider's model settings when you need a model not present in the reported catalog.

## Permissions

Headless `agy` cannot stop and wait for an approval response. T3 Code maps permission modes as
follows:

- **Supervised** denies actions that would need approval.
- **Auto-accept edits** and **Auto** allow file edits but deny commands that need approval.
- **Full access** allows tools without prompting.
- **Plan** uses Antigravity's native plan mode.

When a mode cannot be represented exactly, T3 Code posts a notice in the conversation. See
[Permission modes](./permission-modes.md) for the general behavior.

## Usage Limits

When Antigravity reports plan windows, the composer shows the remaining five-hour and weekly limits.
You can hide these indicators per Antigravity instance with **Show usage limits** in provider
settings. The setting is enabled by default.

## Advanced Launch Arguments

**Launch arguments** are appended to every Antigravity turn. Use this for supported `agy` flags such
as an additional workspace directory. T3 Code owns the prompt, output format, project/conversation,
model, permission, and timeout flags; overriding those can prevent sessions from working correctly.

[install]: https://antigravity.google/docs/cli-getting-started
