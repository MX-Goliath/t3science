# Visual replies and MCP apps

Agents can render self-contained HTML visuals (charts, diagrams, tables, image collages, mockups) and interactive MCP Apps inline in a thread on web, desktop, and mobile.

## Visual replies (HTML renders)

Ask an agent for a visual (e.g. "show this as a chart" or "make a collage of these screenshots"). The rendered page appears above the agent's reply, adapts to your light/dark theme, and runs sandboxed away from your T3 Code session.

- **Local images**: Embedded when published so they stay intact even if the original files move or are deleted.
- **Preview browser**: Before publishing, agents verify their visual with T3 Code's bundled headless Chromium (~120 MB one-time download, shared with [remote browser tabs](./remote-access.md#browser-host-setup)).
- **Network restrictions**: Previews can load public CDN assets but block private/local-network IPs. If Clash/Mihomo fake-IP DNS causes CDN loads to fail, inline the resource, add the host to `fake-ip-filter`, or switch proxy DNS to `redir-host`.

## MCP apps

MCP servers supporting the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) standard render interactive UIs directly below their tool calls (supported on Codex and Claude Code 2.1.301+ on up-to-date T3 servers).

Apps follow your theme. An app can call tools on its own server and post a message to the thread. Tool calls need confirmation unless the thread uses Full access or the server marks the tool as read-only. T3 Code asks before every message. On mobile, an app also asks before opening a link, and T3 Code asks before saving a file an app offers. An app stays viewable after its agent stops, but using it needs the agent of the thread that created it running, so send a message in that thread first if the app says it is unavailable. An app that navigates away from its own page is stopped.

An app can open full screen right after you tap or click in it. On web and desktop, a tap in the app within five seconds of a click or key press elsewhere in T3 Code doesn't count, so tap it again after that. Use the button in its top corner, or press Escape outside the app, to return it to the thread. Anything else that needs your attention, such as an approval, also returns it to the thread. On mobile, full screen opens the app again in its own screen, so anything the app does not save itself starts over. An app can also keep the agent informed of what you did in it, such as a filter you picked; T3 Code sends the latest note from each app with your next message.
