import { assert, it } from "@effect/vitest";

import {
  applyPreferredCodexDefaultModel,
  isLegacyCodexModel,
  mapCodexModelCapabilities,
  normalizeCodexRateLimits,
} from "./CodexProvider.ts";

it("normalizes Codex short and weekly limits as remaining percentages", () => {
  const limits = normalizeCodexRateLimits({
    rateLimits: {
      primary: { usedPercent: 32, windowDurationMins: 300, resetsAt: 1_786_000_000 },
      secondary: { usedPercent: 81, windowDurationMins: 10_080, resetsAt: 1_786_500_000 },
    },
  });

  assert.deepStrictEqual(limits, {
    fiveHour: {
      remainingPercent: 68,
      resetsAt: 1_786_000_000,
      windowDurationMinutes: 300,
    },
    weekly: {
      remainingPercent: 19,
      resetsAt: 1_786_500_000,
      windowDurationMinutes: 10_080,
    },
  });
});

it("keeps the weekly limit when Codex omits the temporary short window", () => {
  const limits = normalizeCodexRateLimits({
    rateLimits: {
      primary: { usedPercent: 24, windowDurationMins: 10_080 },
    },
  });

  assert.deepStrictEqual(limits, {
    weekly: { remainingPercent: 76, windowDurationMinutes: 10_080 },
  });
});

it("prefers the Codex bucket from multi-limit snapshots", () => {
  const limits = normalizeCodexRateLimits({
    rateLimits: {
      primary: { usedPercent: 99, windowDurationMins: 300 },
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        secondary: { usedPercent: 40, windowDurationMins: 10_080 },
      },
    },
  });

  assert.deepStrictEqual(limits, {
    weekly: { remainingPercent: 60, windowDurationMinutes: 10_080 },
  });
});

it("keeps only the GPT-5.6 Codex family out of legacy models", () => {
  assert.deepStrictEqual(
    ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.4"].map((model) => [
      model,
      isLegacyCodexModel(model),
    ]),
    [
      ["gpt-5.6-luna", false],
      ["gpt-5.6-terra", false],
      ["gpt-5.6-sol", false],
      ["gpt-5.4", true],
    ],
  );
});

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
