# Portable local conversations

The desktop app can keep a portable copy of a project's conversations inside that project's
directory. In the current sidebar, open the project selector, choose the project's actions, and
turn on **Portable local conversations**. In the legacy sidebar, right-click the project, choose
**Portable conversations…**, and use the switch in the dialog. This setting is opt-in and applies
only to that project.

When you turn it on, T3 Code immediately exports the project's existing conversations and image
attachments. It then keeps the copies current as you continue working. The files live in the
hidden `.t3/conversations` directory and are not encrypted, so treat the copied project directory
as sensitive data.

## Move a project to another device

1. Close or stop work on the project on the source device so its latest conversation has finished
   exporting.
2. Copy the whole project directory, including the hidden `.t3` directory, with your preferred file
   transfer tool.
3. Add or open that project in the T3 Code desktop app on the destination device.

T3 Code detects the enabled manifest and restores the conversations automatically. Opening a
restored conversation preserves its messages and attachments. The first new message starts a fresh
native provider session and supplies the previous conversation as context, so the agent can
continue the same task using the destination device's project root. The corresponding provider
must be configured on the destination device.

If you later copy a more recently updated project directory back to another device, the newer
portable version replaces the older local copy of the same conversation. Do not edit the same
conversation independently on two devices: portable storage uses the most recently updated copy
and does not merge divergent histories.

Provider-native session identifiers, absolute worktree paths, and local checkpoint Git refs are not
portable. Restored conversations therefore continue from the project root in a new provider
session. The visible conversation and its working context are preserved, but provider-specific
hidden process state is not.

Turning the setting off stops automatic export and import. Existing files in
`.t3/conversations` remain in place until you remove them yourself.
