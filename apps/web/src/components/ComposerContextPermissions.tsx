import { useClientSettings } from "../hooks/useSettings";
import { runtimeModeConfig as scienceRuntimeModeConfig } from "./chat/ScienceRuntimeModeConfig";
import { ComposerPermissionsSection as ScienceComposerPermissionsSection } from "./chat/ScienceComposerFooterControls";
import { cn } from "~/lib/utils";
import type { EnvironmentId, RuntimeMode } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { T, useGT, useMessages } from "gt-react";

import { shortcutLabelForCommand } from "../keybindings";
import { useManagedPolicy } from "../state/managedPolicy";
import { primaryServerKeybindingsAtom } from "../state/server";
import { ComposerControl } from "./chat/ComposerControl";
import { ComposerPermissionsSection } from "./chat/ComposerFooterControls";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  resolveCompatibleRuntimeMode,
  resolveRuntimeModeOptions,
  runtimeModeConfig,
} from "./chat/runtimeModeConfig";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ComposerContextPermissions(props: {
  environmentId: EnvironmentId | null;
  runtimeMode: RuntimeMode;
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const scienceComposer = useClientSettings((settings) => settings.scienceComposer);
  const PermissionsSection = scienceComposer
    ? ScienceComposerPermissionsSection
    : ComposerPermissionsSection;
  const gt = useGT();
  const messages = useMessages();
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.mode",
  );
  const { mode, modes } = resolveCompatibleRuntimeMode(
    props.runtimeMode,
    props.supportedRuntimeModes,
  );
  const options = resolveRuntimeModeOptions(modes, useManagedPolicy(props.environmentId), messages);
  const composerMenuProps = useComposerMenuProps();
  const {
    icon: Icon,
    label,
    iconClassName,
  } = (scienceComposer ? scienceRuntimeModeConfig : runtimeModeConfig)[mode];
  const localizedLabel = messages(label);
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  size="xs"
                  className="ms-auto min-w-0 shrink-0"
                  aria-label={gt("Permissions: {label}", { label: localizedLabel })}
                  data-composer-context-control
                />
              }
            />
          }
        >
          <Icon aria-hidden="true" className={cn("size-3", iconClassName)} />
          <ComposerContextLabel>{localizedLabel}</ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>
          <T>Permissions</T>
          {shortcutLabel ? ` · ${shortcutLabel}` : null}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="top" align="end" {...composerMenuProps}>
        <PermissionsSection
          runtimeMode={mode}
          runtimeModeOptions={options}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </MenuPopup>
    </Menu>
  );
}
