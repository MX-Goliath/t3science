import { useMemo } from "react";
import { Platform } from "react-native";
import { isProjectPromptAction, projectScriptMenuLabel } from "@t3tools/shared/projectScripts";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import type { AppBarAction } from "../../components/ui/AppBar.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import {
  canRunProjectAction,
  getTerminalStatusLabel,
  projectScriptMenuIcon,
} from "../terminal/terminalMenu";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, panes, toggleAuxiliaryPane, composerKeyboardActive } =
    useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderActions = useMemo<ReadonlyArray<AppBarAction>>(() => {
    const actions: AppBarAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    actions.push({
      accessibilityLabel: "Open git controls",
      icon: "point.topleft.down.curvedto.point.bottomright.up",
      onPress: props.onOpenGitInspector,
    });
    if (onMergeBack) {
      actions.push({
        accessibilityLabel: "Merge back to source",
        icon: PullRequestGlyph.merged,
        onPress: onMergeBack,
      });
    }
    return actions;
  }, [
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onMergeBack,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
  ]);

  const controls = props.gitControls;
  const showActions =
    props.hasWorkspaceRoot && (controls.canOpenTerminal || controls.projectScripts.length > 0);
  const menus =
    Platform.OS === "android" && showActions
      ? [
          {
            title: "Terminal and project actions",
            icon: "terminal" as const,
            items: [
              ...controls.projectScripts.map((script) => ({
                id: `script:${script.id}`,
                title: projectScriptMenuLabel(script),
                icon: projectScriptMenuIcon(script.icon),
                subtitle: isProjectPromptAction(script)
                  ? `${script.modelSelection.model} · ${script.prompt}`
                  : script.command,
                disabled: !canRunProjectAction(script, controls),
                onPress: () => void controls.onRunProjectScript(script),
              })),
              ...controls.terminalSessions.map((session) => ({
                id: `terminal:${session.terminalId}`,
                title: session.displayLabel,
                icon: "terminal",
                subtitle: getTerminalStatusLabel(session),
                disabled: !controls.canOpenTerminal,
                onPress: () => onOpenTerminal(session.terminalId),
              })),
              {
                id: "terminal:open",
                title: "Open terminal",
                icon: "terminal",
                disabled: !controls.canOpenTerminal,
                onPress: () => onOpenTerminal(null),
              },
              {
                id: "terminal:new",
                title: "Open new terminal",
                icon: "plus",
                disabled: !controls.canOperateTerminal,
                onPress: controls.onOpenNewTerminal,
              },
            ],
          },
        ]
      : undefined;

  return (
    <>
      <AppBar
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? "Hide inspector"
                  : "Show inspector"
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={layout.usesSplitView ? undefined : goBack}
        actions={androidHeaderActions}
        menus={menus}
        hideBottomBorder
        compact={composerKeyboardActive}
      />
      {native.fallback}
    </>
  );
}
