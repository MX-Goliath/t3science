# Organizing threads

Turn on **General chats** in **Settings → General** to use conversations that do not belong to a
project. The feature is off by default. When enabled, the section appears between Web Chat and
Projects in both the default and legacy web/desktop sidebars. Use its compose button to start a
chat, its heading to collapse or expand the section, and **Show more** when the section contains
more chats than your visible-thread limit.

General chats use an isolated T3 workspace and do not appear in project lists or project settings.
Their chat screen hides project-only controls such as the workspace path, actions, editor
shortcuts, Git setup, terminal, and right-side panels.

When a project's saved folder is no longer available on the environment that owns it, the project
and its local-checkout threads appear dimmed, crossed out, and marked with a warning. Conversation
history remains available, so you can review or remove old threads without recreating the folder.
Threads backed by a separate worktree are not marked from the main project folder's status.

Messages cannot be sent to a local-checkout thread while its project folder is unavailable. Web
and mobile disable the send action, mobile keeps queued messages paused, and the server rejects a
turn if the workspace disappears before it starts. Restore the folder to continue the chat.
While connected, T3 Code periodically rechecks unavailable folders, so reconnecting a removable
drive automatically restores the project and its send action without restarting the client.

Pin a thread from its context menu to keep it above your active work. In the default sidebar,
pinned threads are shown in one shared section independently of their project, including when you
connect to more than one environment. In the legacy sidebar, each project's pinned threads stay
inside that project and appear above its regular threads.

In the default web and desktop sidebar, drag a pinned thread to change its position. On mobile,
open the thread's menu and choose **Move up** or **Move down**. The order is stored by the server
and appears on your other connected devices. The legacy sidebar displays this saved order but does
not provide drag reordering.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Scheduled messages

Right-click the send button in the web or desktop composer to send the current message at a chosen
time. When the active provider reports less than 20% remaining in its 5-hour limit, the same menu
also offers the limit's reset time. If no 5-hour window is reported, T3 Code uses the weekly window.
The reset time is captured when you schedule the message; T3 Code does not keep polling the limit.

When an agent is already working in another chat, the menu also offers **Send after agent finishes**.
Choose the running chat and T3 Code will send the draft as soon as that specific turn completes. The
option is hidden when no other agent is running.

Scheduled chats appear with a blue timer and a subtle blue background above regular threads. Open
one to edit its prompt. The send button becomes a timer; click it to send now or cancel. If T3 Code
was closed when the time passed, the timer is shown in red after reopening and waits for you to
choose what to do instead of sending unexpectedly.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
