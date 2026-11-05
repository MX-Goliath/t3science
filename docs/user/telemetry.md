# Diagnostics and telemetry

This fork does not send product usage events, account or installation identifiers, relay connection
traces, or mobile crash reports to T3 Code, PostHog, or Axiom. No opt-out setting is required.

Logs, traces, and resource diagnostics stay with your environment. Browser diagnostics are sent to
the T3 Code server you connected to and stored there locally. You can copy a mobile startup crash
report from **Settings > About T3 Code > Diagnostics** and share it manually after reviewing it.

External OpenTelemetry export and endpoint checks have been removed. Saved OTLP endpoints and
telemetry environment variables cannot enable sending; endpoint checks are rejected locally.

Provider requests and remote connections still transfer the data needed for those features.
