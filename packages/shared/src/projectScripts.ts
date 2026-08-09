import type { ProjectScript } from "@t3tools/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export type ProjectPromptAction = ProjectScript & {
  readonly kind: "prompt";
  readonly prompt: string;
  readonly modelSelection: NonNullable<ProjectScript["modelSelection"]>;
};

export function isProjectPromptAction(script: ProjectScript): script is ProjectPromptAction {
  return (
    script.kind === "prompt" && script.prompt !== undefined && script.modelSelection !== undefined
  );
}

export type ProjectCommandAction = ProjectScript & {
  readonly kind?: undefined;
  readonly command: string;
};

export function isProjectCommandAction(script: ProjectScript): script is ProjectCommandAction {
  return script.kind !== "prompt" && script.command !== undefined;
}

function isProjectCommandActionWithSetup(script: ProjectScript): script is ProjectCommandAction {
  return isProjectCommandAction(script) && script.runOnWorktreeCreate;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectCommandAction | null {
  return scripts.find(isProjectCommandActionWithSetup) ?? null;
}
