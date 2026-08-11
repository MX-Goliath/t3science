/**
 * antigravityLaunchArgs — pure argv construction for `agy` headless turns.
 *
 * Kept separate from the adapter so the flag matrix (permission modes,
 * conversation continuation, workspace binding) is testable without spawning
 * anything.
 *
 * Two facts drive the shape of every command line here:
 *
 *  1. `agy` binds its workspace to a *project*, not to the process cwd. A
 *     first turn therefore passes `--new-project`, which adopts the cwd; every
 *     later turn passes `--conversation <id>`, which restores the project the
 *     conversation belongs to.
 *  2. Headless `agy` cannot prompt for tool approval. It either auto-approves
 *     everything (`--dangerously-skip-permissions`), auto-approves edits only
 *     (`--mode accept-edits`), or soft-denies anything that would need a
 *     prompt. T3 permission modes map onto that three-way choice.
 *
 * @module provider/Layers/antigravityLaunchArgs
 */
import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";

export const T3CODE_ANTIGRAVITY_LAUNCH_ARGS_ENV = "T3CODE_ANTIGRAVITY_LAUNCH_ARGS";

/**
 * `agy` defaults `--print-timeout` to 5 minutes and kills the run when it
 * expires. Agent turns routinely run longer, so T3 raises the ceiling and lets
 * its own interrupt path own cancellation. Users can still lower it through
 * launch arguments — Go's flag parser keeps the last occurrence.
 */
export const ANTIGRAVITY_PRINT_TIMEOUT = "24h";

export const resolveAntigravityLaunchArgs = (
  launchArgs?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string => environment[T3CODE_ANTIGRAVITY_LAUNCH_ARGS_ENV]?.trim() || launchArgs?.trim() || "";

export const antigravityLaunchArgv = (launchArgs?: string): ReadonlyArray<string> =>
  tokenizeCliArgs(launchArgs);

export type AntigravityEffort = "low" | "medium" | "high";

export function isAntigravityEffort(value: string | undefined): value is AntigravityEffort {
  return value === "low" || value === "medium" || value === "high";
}

/** How a T3 permission mode is realized on the `agy` command line. */
export type AntigravityPermissionPlan = {
  /** `--dangerously-skip-permissions` */
  readonly skipPermissions: boolean;
  /** `--mode <value>`; absent means the CLI default ("request-review"). */
  readonly mode?: "accept-edits" | "plan";
  /**
   * Set when the resulting command line cannot honor the requested mode
   * faithfully, so the adapter can tell the user once per turn instead of
   * letting tools fail with an unexplained denial.
   */
  readonly degraded?: string;
};

const CANNOT_PROMPT =
  "Antigravity runs headless and cannot ask for approval, so tools that would need one are denied automatically.";

export function antigravityPermissionPlan(input: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}): AntigravityPermissionPlan {
  if (input.interactionMode === "plan") {
    return { skipPermissions: false, mode: "plan" };
  }
  switch (input.runtimeMode) {
    case "full-access":
      return { skipPermissions: true };
    case "auto":
    // `auto` has no Antigravity equivalent — there is no reviewer to delegate
    // routine approvals to — so it lands on the same footing as
    // auto-accept-edits rather than silently unlocking commands.
    case "auto-accept-edits":
      return {
        skipPermissions: false,
        mode: "accept-edits",
        degraded: `${CANNOT_PROMPT} File edits are auto-approved; commands are not.`,
      };
    case "approval-required":
      return {
        skipPermissions: false,
        degraded: `${CANNOT_PROMPT} Switch to Full access to let it edit files and run commands.`,
      };
  }
}

export interface AntigravityTurnArgsInput {
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly effort?: AntigravityEffort | undefined;
  /** Resume target; when absent the turn opens a new conversation. */
  readonly conversationId?: string | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly additionalDirectories?: ReadonlyArray<string> | undefined;
  readonly launchArgs?: string | undefined;
  readonly outputFormat?: "stream-json" | "json" | "text";
  readonly printTimeout?: string | undefined;
}

/**
 * Build the argv for one turn. `--print` goes last so the prompt is always the
 * final token: Go's `flag` package stops parsing at the first positional, and
 * a prompt that starts with `-` must never be mistaken for a flag.
 */
export function buildAntigravityTurnArgs(input: AntigravityTurnArgsInput): ReadonlyArray<string> {
  const permission = antigravityPermissionPlan({
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  });
  const args: Array<string> = [
    "--output-format",
    input.outputFormat ?? "stream-json",
    "--print-timeout",
    input.printTimeout ?? ANTIGRAVITY_PRINT_TIMEOUT,
  ];

  if (input.model?.trim()) {
    args.push("--model", input.model.trim());
  }
  if (input.effort) {
    args.push("--effort", input.effort);
  }
  if (permission.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (permission.mode) {
    args.push("--mode", permission.mode);
  }
  if (input.conversationId?.trim()) {
    args.push("--conversation", input.conversationId.trim());
  } else {
    // Without this the CLI runs the turn in its scratch directory instead of
    // the thread's working directory.
    args.push("--new-project");
  }
  for (const directory of input.additionalDirectories ?? []) {
    const trimmed = directory.trim();
    if (trimmed.length > 0) args.push("--add-dir", trimmed);
  }
  args.push(...antigravityLaunchArgv(input.launchArgs));
  args.push("--print", input.prompt);
  return args;
}

/**
 * Argv for a print-mode CLI command such as `/usage` or `/model`. These
 * resolve locally: no model turn, no project, no permissions.
 */
export function buildAntigravityCommandArgs(command: string): ReadonlyArray<string> {
  return ["--output-format", "json", "--print", command];
}

/**
 * Windows caps a command line at 32,767 characters and the prompt travels in
 * argv, so oversized prompts are rejected up front with an actionable message
 * rather than as an opaque spawn failure.
 */
export const ANTIGRAVITY_WINDOWS_PROMPT_LIMIT = 30_000;

export function isAntigravityPromptTooLongForPlatform(input: {
  readonly prompt: string;
  readonly platform: string;
}): boolean {
  return input.platform === "win32" && input.prompt.length > ANTIGRAVITY_WINDOWS_PROMPT_LIMIT;
}
