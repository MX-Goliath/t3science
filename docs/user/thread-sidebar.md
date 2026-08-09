# Organizing threads

Turn on **General chats** in **Settings → General** to use conversations that do not belong to a
project. The feature is off by default. When enabled, the section appears between Web Chat and
Projects in both the default and legacy web/desktop sidebars. Use its compose button to start a
chat, its heading to collapse or expand the section, and **Show more** when the section contains
more chats than your visible-thread limit.

General chats use an isolated T3 workspace and do not appear in project lists or project settings.
Their chat screen hides project-only controls such as the workspace path, actions, editor
shortcuts, Git setup, terminal, and right-side panels.

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

Scheduled chats appear with a blue timer and a subtle blue background above regular threads. Open
one to edit its prompt. The send button becomes a timer; click it to send now or cancel. If T3 Code
was closed when the time passed, the timer is shown in red after reopening and waits for you to
choose what to do instead of sending unexpectedly.
