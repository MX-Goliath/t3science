# Project settings

## Customize a project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To choose a different icon:

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Under **Appearance**, select **Choose a project file**.
4. Search for an image file and select it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.

## Create project actions

Project actions are reusable shortcuts in a thread's top bar. Open **Settings**, select
**Projects**, choose a project, and use the **Actions** section to add one.

An action can either run a terminal command in the current project workspace or start a new chat
with a saved prompt. Prompt actions also save the provider model and its reasoning level, so every
run uses the intended configuration. Running a prompt action creates the chat immediately and
sends the saved prompt; the existing thread remains unchanged.

Actions can have keybindings. Terminal actions can also open a preview URL, and one terminal
action can be selected as the automatic setup command for newly created worktrees. Prompt actions
do not run as worktree setup commands.
