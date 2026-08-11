#!/usr/bin/env node
// Stand-in for the Antigravity CLI (`agy`) in adapter tests.
//
// Emits the same NDJSON envelopes as `agy --print … --output-format
// stream-json` (CLI 1.1.11). The scenario is selected with
// `T3_MOCK_AGY_SCENARIO`; every invocation appends its argv as one JSON line to
// `T3_MOCK_AGY_ARGS_FILE` so tests can assert on the command line the adapter
// built.
import * as NodeFS from "node:fs";

const argv = process.argv.slice(2);
const scenario = process.env.T3_MOCK_AGY_SCENARIO ?? "basic";
const argsFile = process.env.T3_MOCK_AGY_ARGS_FILE;
if (argsFile) {
  NodeFS.appendFileSync(argsFile, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
}

function flagValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const conversationId =
  flagValue("--conversation") ?? process.env.T3_MOCK_AGY_CONVERSATION_ID ?? "conv-mock-1";
const model = flagValue("--model") ?? "gemini-3.1-pro-high";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function init() {
  emit({
    event: "init",
    conversation_id: conversationId,
    init: {
      model,
      cwd: process.cwd(),
      tools: ["run_command", "write_to_file"],
      permission_mode: argv.includes("--dangerously-skip-permissions")
        ? "always-proceed"
        : "request-review",
    },
  });
}

function step(stepUpdate) {
  emit({ event: "step_update", step_update: { conversation_id: conversationId, ...stepUpdate } });
}

function result(payload) {
  emit({ event: "result", result: { conversation_id: conversationId, ...payload } });
}

const USAGE = {
  input_tokens: 120,
  output_tokens: 30,
  thinking_tokens: 0,
  cache_read_tokens: 900,
  total_tokens: 150,
};

switch (scenario) {
  case "basic": {
    init();
    step({ step_index: 0, state: "DONE", step_type: "user_input" });
    step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Listing " });
    step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "files" });
    step({
      step_index: 1,
      state: "DONE",
      step_type: "agent_response",
      text_delta: ".\n",
      usage: USAGE,
    });
    step({
      step_index: 2,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "run_command",
      tool_info: { name: "run_command", parameters: { CommandLine: "ls -la" } },
    });
    step({
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "run_command",
      duration_seconds: 0.5,
      tool_info: {
        name: "run_command",
        parameters: { CommandLine: "ls -la" },
        output: "total 0\n",
      },
    });
    step({ step_index: 3, state: "DONE", step_type: "checkpoint", duration_seconds: 0.1 });
    result({
      status: "SUCCESS",
      response: "Listing files.\n",
      duration_seconds: 1.2,
      num_turns: 1,
      usage: USAGE,
    });
    break;
  }
  case "denied": {
    init();
    step({
      step_index: 0,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "write_to_file",
      tool_info: { name: "write_to_file", parameters: { TargetFile: "/tmp/x.txt" } },
    });
    step({
      step_index: 0,
      state: "ERROR",
      step_type: "tool",
      tool_name: "write_to_file",
      tool_info: {
        name: "write_to_file",
        parameters: { TargetFile: "/tmp/x.txt" },
        error: { type: "TOOL_ERROR", message: "User denied permission for write_file(/tmp/x.txt)" },
      },
    });
    result({ status: "SUCCESS", response: "I could not write the file.\n", num_turns: 1 });
    break;
  }
  case "provider-error": {
    init();
    step({ step_index: 0, state: "DONE", step_type: "error_message" });
    result({
      status: "ERROR",
      response: "",
      error: "Agent execution terminated due to error.",
      num_turns: 1,
    });
    break;
  }
  case "command-only": {
    // `/usage` and friends resolve inside the CLI: no init, no steps.
    result({ status: "SUCCESS", response: "Weekly Limit Remaining\t93%\n", num_turns: 0 });
    break;
  }
  case "stdin-eof": {
    // Real headless `agy` waits while stdin is an open pipe even though the
    // prompt is passed through argv. The adapter must connect stdin to EOF.
    for await (const _chunk of process.stdin) {
      // No input is expected.
    }
    init();
    result({ status: "SUCCESS", response: "stdin closed\n", num_turns: 1 });
    break;
  }
  case "crash": {
    process.stderr.write("agy: fatal: something went wrong\n");
    process.exit(3);
    break;
  }
  case "hang": {
    init();
    step({ step_index: 0, state: "ACTIVE", step_type: "agent_response", text_delta: "Working" });
    // Stay alive until the adapter terminates the process group.
    setInterval(() => {}, 1_000);
    break;
  }
  default: {
    process.stderr.write(`unknown scenario: ${scenario}\n`);
    process.exit(2);
  }
}
