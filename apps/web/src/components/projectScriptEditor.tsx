import type {
  ModelSelection,
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { isProjectCommandAction, isProjectPromptAction } from "@t3tools/shared/projectScripts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  BugIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  WrenchIcon,
} from "lucide-react";
import React, { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import { keybindingFromKeyboardEvent } from "~/components/settings/KeybindingsSettings.logic";
import { commandForProjectScript, nextProjectScriptId } from "~/projectScripts";
import type { ProviderInstanceEntry } from "~/providerInstances";
import type { ModelEsque } from "./chat/providerIconUtils";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

export const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export interface NewProjectScriptInput {
  name: string;
  kind: "command" | "prompt";
  command: string;
  prompt: string;
  modelSelection: ModelSelection | null;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  keybinding: string | null;
  /** Optional URL to open in the in-app preview when this script runs. */
  previewUrl: string | null;
  /** When true, automatically open the preview panel pointed at `previewUrl`. */
  autoOpenPreview: boolean;
}

export type ProjectScriptActionResult = AtomCommandResult<void, unknown>;

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  kind: "command",
  command: "",
  prompt: "",
  modelSelection: null,
  icon: "play",
  runOnWorktreeCreate: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

/** What the editor dialog should open with. `scriptId: null` means "add". */
export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  /** Validation error to show immediately (e.g. a failed t3.json import). */
  error?: string;
}

export function editorRequestForScript(
  script: ProjectScript,
  keybindings: ResolvedKeybindingsConfig,
): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      kind: isProjectPromptAction(script) ? "prompt" : "command",
      command: isProjectCommandAction(script) ? script.command : "",
      prompt: isProjectPromptAction(script) ? script.prompt : "",
      modelSelection: isProjectPromptAction(script) ? script.modelSelection : null,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

/**
 * Add/edit dialog for a project script, shared by the chat-header scripts menu
 * and the project settings page. The parent owns which script (if any) is
 * being edited via `request`; the dialog owns the form state and validation.
 */
export function ProjectScriptEditorDialog({
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
  defaultModelSelection,
  modelPicker,
}: {
  request: ProjectScriptEditorRequest | null;
  /** Existing scripts, used to derive a unique id for new scripts. */
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
  defaultModelSelection: ModelSelection | null;
  modelPicker: {
    readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
    readonly modelOptionsByInstance: ReadonlyMap<
      ModelSelection["instanceId"],
      ReadonlyArray<ModelEsque>
    >;
  };
}) {
  const formId = React.useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"command" | "prompt">("command");
  const [command, setCommand] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const isOpen = request !== null;
  const isEditing = request?.scriptId != null;
  const selectedModelEntry = modelPicker.instanceEntries.find(
    (entry) => entry.instanceId === modelSelection?.instanceId,
  );

  // Hydrate the form whenever a new request opens the dialog.
  useEffect(() => {
    if (!request) return;
    setName(request.initial.name);
    setKind(request.initial.kind);
    setCommand(request.initial.command);
    setPrompt(request.initial.prompt);
    setModelSelection(request.initial.modelSelection ?? defaultModelSelection);
    setIcon(request.initial.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(request.initial.runOnWorktreeCreate);
    setKeybinding(request.initial.keybinding ?? "");
    setPreviewUrl(request.initial.previewUrl ?? "");
    setAutoOpenPreview(request.initial.autoOpenPreview);
    setValidationError(request.error ?? null);
  }, [defaultModelSelection, request]);

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromKeyboardEvent(event, navigator.platform);
    if (!next) return;
    setKeybinding(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request) return;
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const trimmedPrompt = prompt.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (kind === "command" && trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }
    if (kind === "prompt" && trimmedPrompt.length === 0) {
      setValidationError("Prompt is required.");
      return;
    }
    if (kind === "prompt" && modelSelection === null) {
      setValidationError("Choose a model for this prompt.");
      return;
    }

    setValidationError(null);
    let payload: NewProjectScriptInput;
    try {
      const scriptIdForValidation =
        request.scriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const trimmedPreviewUrl = previewUrl.trim();
      payload = {
        name: trimmedName,
        kind,
        command: kind === "command" ? trimmedCommand : "",
        prompt: kind === "prompt" ? trimmedPrompt : "",
        modelSelection: kind === "prompt" ? modelSelection : null,
        icon,
        runOnWorktreeCreate: kind === "command" ? runOnWorktreeCreate : false,
        keybinding: keybindingRule?.key ?? null,
        previewUrl: kind === "command" && trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview:
          kind === "command" && trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      } satisfies NewProjectScriptInput;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      return;
    }

    const result = await onSubmit(request.scriptId, payload);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      }
      return;
    }
    setIconPickerOpen(false);
    onClose();
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIconPickerOpen(false);
            onClose();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Actions run a project command or start a chat from the top bar or a keybinding.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="script-name">Name</Label>
                <div className="flex items-center gap-2">
                  <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:border-transparent dark:bg-white/[0.035] dark:data-pressed:before:shadow-none"
                          aria-label="Choose icon"
                        />
                      }
                    >
                      <ScriptIcon icon={icon} className="size-4.5" />
                    </PopoverTrigger>
                    <PopoverPopup align="start">
                      <div className="grid grid-cols-3 gap-2">
                        {SCRIPT_ICONS.map((entry) => {
                          const isSelected = entry.id === icon;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs dark:border-transparent ${
                                isSelected
                                  ? "border-primary/70 bg-primary/10 dark:ring-1 dark:ring-primary/30"
                                  : "border-border/70 hover:bg-accent/60 dark:bg-white/[0.035]"
                              }`}
                              onClick={() => {
                                setIcon(entry.id);
                                setIconPickerOpen(false);
                              }}
                            >
                              <ScriptIcon icon={entry.id} className="size-4" />
                              <span>{entry.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverPopup>
                  </Popover>
                  <Input
                    id="script-name"
                    autoFocus
                    placeholder="Test"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-kind">Action type</Label>
                <Select
                  value={kind}
                  onValueChange={(value) => {
                    const nextKind = value as "command" | "prompt";
                    setKind(nextKind);
                    if (nextKind === "prompt" && modelSelection === null) {
                      setModelSelection(defaultModelSelection);
                    }
                  }}
                >
                  <SelectTrigger id="script-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="command">Terminal command</SelectItem>
                    <SelectItem value="prompt">New chat prompt</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-keybinding">Keybinding</Label>
                <Input
                  id="script-keybinding"
                  placeholder="Press shortcut"
                  value={keybinding}
                  readOnly
                  onKeyDown={captureKeybinding}
                />
                <p className="text-xs text-muted-foreground">
                  Press a shortcut. Use <code>Backspace</code> to clear.
                </p>
              </div>
              {kind === "command" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="script-command">Command</Label>
                  <Textarea
                    id="script-command"
                    placeholder="bun test"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="script-prompt">Prompt</Label>
                    <Textarea
                      id="script-prompt"
                      placeholder="Review this project and suggest the next highest-impact improvement."
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Running this action starts a new chat in the current project.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model and reasoning</Label>
                    {modelSelection ? (
                      <div className="flex flex-wrap gap-1.5">
                        <ProviderModelPicker
                          activeInstanceId={modelSelection.instanceId}
                          model={modelSelection.model}
                          lockedProvider={null}
                          instanceEntries={modelPicker.instanceEntries}
                          modelOptionsByInstance={modelPicker.modelOptionsByInstance}
                          triggerVariant="outline"
                          triggerClassName="min-w-0 max-w-none flex-1"
                          triggerAriaLabel="Prompt model"
                          onInstanceModelChange={(instanceId, model) =>
                            setModelSelection(createModelSelection(instanceId, model))
                          }
                        />
                        {selectedModelEntry ? (
                          <TraitsPicker
                            provider={selectedModelEntry.driverKind}
                            models={selectedModelEntry.models}
                            model={modelSelection.model}
                            prompt={prompt}
                            onPromptChange={setPrompt}
                            modelOptions={modelSelection.options ?? []}
                            triggerVariant="outline"
                            triggerClassName="min-w-0 max-w-none"
                            onModelOptionsChange={(options) =>
                              setModelSelection(
                                createModelSelection(
                                  modelSelection.instanceId,
                                  modelSelection.model,
                                  options,
                                ),
                              )
                            }
                          />
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Configure an available provider before creating a prompt action.
                      </p>
                    )}
                  </div>
                </>
              )}
              {kind === "command" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="script-preview-url">Preview URL (optional)</Label>
                  <Input
                    id="script-preview-url"
                    placeholder="http://localhost:5173"
                    value={previewUrl}
                    onChange={(event) => setPreviewUrl(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Open this URL in the in-app preview when this action runs.
                  </p>
                </div>
              ) : null}
              {kind === "command" ? (
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
                  <span>Run automatically on worktree creation</span>
                  <Switch
                    checked={runOnWorktreeCreate}
                    onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                  />
                </label>
              ) : null}
              {kind === "command" ? (
                <label
                  className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                    previewUrl.trim().length === 0 ? "opacity-60" : ""
                  }`}
                >
                  <span>Open preview automatically when this action runs</span>
                  <Switch
                    checked={autoOpenPreview}
                    disabled={previewUrl.trim().length === 0}
                    onCheckedChange={(checked) => setAutoOpenPreview(Boolean(checked))}
                  />
                </label>
              ) : null}
              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter className="dark:border-transparent dark:bg-transparent">
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button form={formId} type="submit">
              {isEditing ? "Save changes" : "Save action"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (!request?.scriptId) return;
                setDeleteConfirmOpen(false);
                onClose();
                onDelete(request.scriptId);
              }}
            >
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
