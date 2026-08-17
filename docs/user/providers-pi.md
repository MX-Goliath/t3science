# Pi

T3 Code can run [Pi](https://pi.dev) as a first-class provider through Pi's RPC mode. Install Pi on the machine that runs the T3 Code server, then configure authentication in Pi itself:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
```

Open **Settings → Providers → Pi** to check availability. If `pi` is not on the server's `PATH`, set **Binary path** to the executable. **Session directory** is optional; leave it blank to use Pi's normal session location.

## Models and thinking

T3 Code asks the installed Pi runtime for its configured models. It does not substitute a fallback model when discovery fails. Configure providers, credentials, and custom models in Pi, then refresh the Pi provider in T3 Code.

Thinking choices are also read from Pi for each model. Models without reasoning only offer `Off`; models with extended reasoning can expose levels through `Max`.

## Context window

After each settled turn, the composer shows Pi's current context-window usage. This is the active context estimate Pi uses for compaction, not the cumulative number of tokens processed by the session.

## Permissions

Pi does not expose an approval protocol over RPC. Pi sessions therefore run only in **Full access** mode. T3 Code rejects a Pi session started with another permission mode rather than silently weakening that mode.

## Resuming sessions

T3 Code stores Pi's session cursor with the thread and reopens that session for later turns. Moving the Pi session file or changing to an incompatible session directory can prevent a thread from resuming.
