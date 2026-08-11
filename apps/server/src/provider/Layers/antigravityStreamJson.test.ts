import { describe, expect, it } from "@effect/vitest";

import {
  accumulateAntigravityUsage,
  antigravityStepKind,
  antigravityToolItemData,
  antigravityToolTitle,
  antigravityUsageSnapshot,
  canonicalItemTypeForAntigravityStep,
  canonicalItemTypeForAntigravityTool,
  emptyAntigravityUsageAccumulator,
  isAntigravityPermissionDenial,
  parseAntigravityStreamLine,
  runtimeItemStatusForAntigravityStep,
  type AntigravityStepUpdate,
} from "./antigravityStreamJson.ts";

// Verbatim lines from `agy --print … --output-format stream-json` (CLI 1.1.11).
const INIT_LINE = `{"event":"init","conversation_id":"7c5628fa-9887-4dfe-ae38-31db9a43d867","init":{"model":"claude-sonnet-4-6","cwd":"/tmp/agyprobe","tools":["run_command","write_to_file"],"permission_mode":"request-review"}}`;
const TEXT_DELTA_LINE = `{"event":"step_update","step_update":{"conversation_id":"7c5628fa","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"I'll list the directory"}}`;
const TEXT_DONE_LINE = `{"event":"step_update","step_update":{"conversation_id":"7c5628fa","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"\\n","duration_seconds":5.41,"usage":{"input_tokens":18568,"output_tokens":317,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":18885}}}`;
const TOOL_START_LINE = `{"event":"step_update","step_update":{"conversation_id":"7c5628fa","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"}}}}`;
const TOOL_DONE_LINE = `{"event":"step_update","step_update":{"conversation_id":"7c5628fa","step_index":3,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.82,"tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"},"output":"total 8\\r\\n"}}}`;
const TOOL_DENIED_LINE = `{"event":"step_update","step_update":{"conversation_id":"7c5628fa","step_index":3,"state":"ERROR","step_type":"tool","tool_name":"write_to_file","duration_seconds":1.23,"tool_info":{"name":"write_to_file","parameters":{"TargetFile":"/tmp/agyprobe/perm.txt"},"error":{"type":"TOOL_ERROR","message":"User denied permission for write_file(/tmp/agyprobe/perm.txt)"}}}}`;
const RESULT_LINE = `{"event":"result","result":{"conversation_id":"7c5628fa","status":"SUCCESS","response":"Done.\\n","duration_seconds":12.3,"num_turns":1,"usage":{"input_tokens":513,"output_tokens":123,"thinking_tokens":0,"cache_read_tokens":19082,"total_tokens":636}}}`;

function stepFrom(line: string): AntigravityStepUpdate {
  const event = parseAntigravityStreamLine(line);
  if (event?._tag !== "step") throw new Error(`expected a step event, got ${event?._tag}`);
  return event.step;
}

describe("parseAntigravityStreamLine", () => {
  it("decodes the init envelope", () => {
    const event = parseAntigravityStreamLine(INIT_LINE);
    expect(event?._tag).toBe("init");
    if (event?._tag !== "init") return;
    expect(event.init.conversationId).toBe("7c5628fa-9887-4dfe-ae38-31db9a43d867");
    expect(event.init.model).toBe("claude-sonnet-4-6");
    expect(event.init.cwd).toBe("/tmp/agyprobe");
    expect(event.init.permissionMode).toBe("request-review");
    expect(event.init.tools).toEqual(["run_command", "write_to_file"]);
  });

  it("keeps text delta whitespace verbatim", () => {
    expect(stepFrom(TEXT_DONE_LINE).textDelta).toBe("\n");
  });

  it("decodes tool parameters, output, and errors", () => {
    const done = stepFrom(TOOL_DONE_LINE);
    expect(done.toolName).toBe("run_command");
    expect(done.toolInfo?.parameters).toEqual({ CommandLine: "ls -la" });
    expect(done.toolInfo?.output).toBe("total 8\r\n");

    const denied = stepFrom(TOOL_DENIED_LINE);
    expect(denied.toolInfo?.error?.type).toBe("TOOL_ERROR");
    expect(denied.toolInfo?.error?.message).toContain("denied permission");
  });

  it("decodes the result envelope", () => {
    const event = parseAntigravityStreamLine(RESULT_LINE);
    expect(event?._tag).toBe("result");
    if (event?._tag !== "result") return;
    expect(event.result.status).toBe("SUCCESS");
    expect(event.result.response).toBe("Done.\n");
    expect(event.result.usage?.cacheReadTokens).toBe(19082);
  });

  it("ignores blank lines and non-JSON CLI chatter", () => {
    expect(parseAntigravityStreamLine("")).toBeUndefined();
    expect(parseAntigravityStreamLine("   ")).toBeUndefined();
    expect(parseAntigravityStreamLine("Fetching available models...")).toBeUndefined();
    expect(parseAntigravityStreamLine("{not json")).toBeUndefined();
  });

  it("degrades unknown envelopes instead of failing", () => {
    expect(parseAntigravityStreamLine(`{"event":"future_event","payload":{}}`)?._tag).toBe(
      "unknown",
    );
    // A step_update envelope from a newer CLI with an unfamiliar step type is
    // still a step; only the classification changes.
    const event = parseAntigravityStreamLine(
      `{"event":"step_update","step_update":{"step_index":9,"state":"DONE","step_type":"time_travel"}}`,
    );
    expect(event?._tag).toBe("step");
  });
});

describe("step classification", () => {
  it("classifies the step types the CLI emits today", () => {
    expect(antigravityStepKind(stepFrom(TEXT_DELTA_LINE))).toBe("assistant");
    expect(antigravityStepKind(stepFrom(TOOL_START_LINE))).toBe("tool");
    expect(antigravityStepKind({ stepIndex: 0, state: "DONE", stepType: "user_input" })).toBe(
      "silent",
    );
    expect(antigravityStepKind({ stepIndex: 1, state: "DONE", stepType: "checkpoint" })).toBe(
      "silent",
    );
    expect(antigravityStepKind({ stepIndex: 2, state: "DONE", stepType: "error_message" })).toBe(
      "error",
    );
    expect(antigravityStepKind({ stepIndex: 3, state: "DONE", stepType: "thinking" })).toBe(
      "reasoning",
    );
  });

  it("treats an unknown step type carrying a tool name as a tool", () => {
    expect(
      antigravityStepKind({
        stepIndex: 4,
        state: "ACTIVE",
        stepType: "future_tool_step",
        toolName: "teleport",
      }),
    ).toBe("tool");
    expect(canonicalItemTypeForAntigravityTool("teleport")).toBe("dynamic_tool_call");
  });

  it("maps tool names onto canonical item types", () => {
    expect(canonicalItemTypeForAntigravityTool("run_command")).toBe("command_execution");
    expect(canonicalItemTypeForAntigravityTool("write_to_file")).toBe("file_change");
    expect(canonicalItemTypeForAntigravityTool("multi_replace_file_content")).toBe("file_change");
    expect(canonicalItemTypeForAntigravityTool("search_web")).toBe("web_search");
    expect(canonicalItemTypeForAntigravityTool("call_mcp_tool")).toBe("mcp_tool_call");
    expect(canonicalItemTypeForAntigravityTool("invoke_subagent")).toBe("collab_agent_tool_call");
    expect(canonicalItemTypeForAntigravityTool("capture_browser_screenshot")).toBe("image_view");
    expect(canonicalItemTypeForAntigravityTool(undefined)).toBe("dynamic_tool_call");
  });

  it("maps a completed assistant step to an assistant message", () => {
    expect(canonicalItemTypeForAntigravityStep(stepFrom(TEXT_DONE_LINE))).toBe("assistant_message");
  });

  it("separates a denied tool from a failed one", () => {
    const denied = stepFrom(TOOL_DENIED_LINE);
    expect(isAntigravityPermissionDenial(denied)).toBe(true);
    expect(runtimeItemStatusForAntigravityStep(denied)).toBe("declined");

    const failed: AntigravityStepUpdate = {
      ...denied,
      toolInfo: { ...denied.toolInfo, error: { type: "TOOL_ERROR", message: "disk full" } },
    };
    expect(isAntigravityPermissionDenial(failed)).toBe(false);
    expect(runtimeItemStatusForAntigravityStep(failed)).toBe("failed");
    expect(runtimeItemStatusForAntigravityStep(stepFrom(TOOL_START_LINE))).toBe("inProgress");
    expect(runtimeItemStatusForAntigravityStep(stepFrom(TOOL_DONE_LINE))).toBe("completed");
  });
});

describe("tool presentation", () => {
  it("titles a command with the command line", () => {
    expect(antigravityToolTitle(stepFrom(TOOL_START_LINE))).toBe("ls -la");
  });

  it("titles a file tool with its target path", () => {
    expect(antigravityToolTitle(stepFrom(TOOL_DENIED_LINE))).toBe(
      "write_to_file: /tmp/agyprobe/perm.txt",
    );
  });

  it("falls back to the bare tool name", () => {
    expect(
      antigravityToolTitle({
        stepIndex: 0,
        state: "ACTIVE",
        stepType: "tool",
        toolName: "list_permissions",
      }),
    ).toBe("list_permissions");
  });

  it("lifts command and path onto the item payload for clients", () => {
    expect(antigravityToolItemData(stepFrom(TOOL_DONE_LINE))).toMatchObject({
      toolName: "run_command",
      command: "ls -la",
      output: "total 8\r\n",
      durationSeconds: 0.82,
    });
    expect(antigravityToolItemData(stepFrom(TOOL_DENIED_LINE)).path).toBe("/tmp/agyprobe/perm.txt");
  });
});

describe("usage accounting", () => {
  it("tracks the live context window from the latest step and accumulates output", () => {
    const first = accumulateAntigravityUsage(
      emptyAntigravityUsageAccumulator,
      stepFrom(TEXT_DONE_LINE).usage,
    );
    const second = accumulateAntigravityUsage(first, {
      inputTokens: 513,
      outputTokens: 123,
      cacheReadTokens: 19_082,
      thinkingTokens: 40,
    });

    // Output accumulates across steps…
    expect(second.totalOutputTokens).toBe(317 + 123);
    expect(second.totalThinkingTokens).toBe(40);
    // …while the prompt size is whatever the most recent step reported.
    expect(second.lastInputTokens).toBe(513);
    expect(second.lastCachedInputTokens).toBe(19_082);

    const snapshot = antigravityUsageSnapshot({ ...second, toolUses: 2 });
    expect(snapshot.usedTokens).toBe(513 + 19_082 + 123);
    expect(snapshot.inputTokens).toBe(513);
    expect(snapshot.cachedInputTokens).toBe(19_082);
    expect(snapshot.outputTokens).toBe(440);
    expect(snapshot.toolUses).toBe(2);
    expect(snapshot.compactsAutomatically).toBe(true);
  });

  it("ignores steps that report no usage", () => {
    expect(accumulateAntigravityUsage(emptyAntigravityUsageAccumulator, undefined)).toEqual(
      emptyAntigravityUsageAccumulator,
    );
  });
});
