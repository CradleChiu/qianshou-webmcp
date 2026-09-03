import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRouteSelectionPrompt,
  selectRouteCandidate,
  validateRouteSelectionRequest,
  validateRouteSelectionResult,
} from "./route-selection.mjs";

const request = {
  preferences: {
    minimizeWalking: true,
    minimizeTransfers: true,
    stepFree: true,
  },
  candidates: [
    {
      id: "route-1",
      estimatedMinutes: 174,
      walkingMinutes: 174,
      transfers: 0,
      usesTransit: false,
      transitModes: [],
      routeNames: [],
      accessibilityScore: null,
    },
    {
      id: "route-2",
      estimatedMinutes: 48,
      walkingMinutes: 12,
      transfers: 1,
      usesTransit: true,
      transitModes: ["RAIL", "BUS"],
      routeNames: ["區間車", "公車"],
      accessibilityScore: null,
    },
  ],
};

test("validates a bounded route-selection request", () => {
  assert.deepEqual(validateRouteSelectionRequest(request), request);
});

test("route-selection prompt keeps the Agent inside existing OTP candidates", () => {
  const prompt = buildRouteSelectionPrompt(request);
  assert.match(prompt, /OTP 已經產生真實候選/);
  assert.match(prompt, /只能從候選中的 id 選擇/);
  assert.match(prompt, /不要只因為純步行是 0 次轉乘/);
  assert.match(prompt, /null 代表未知/);
});

test("rejects an invented route candidate id", () => {
  assert.throws(
    () =>
      validateRouteSelectionResult(
        { candidateId: "invented", confidence: "high", reason: "猜測" },
        new Set(["route-1", "route-2"]),
      ),
    /不存在/,
  );
});

test("runs an isolated low-reasoning Codex route selection", async () => {
  const result = await selectRouteCandidate(request, {
    runner: async (args) => {
      assert.ok(args.includes('model_reasoning_effort="low"'));
      const outputIndex = args.indexOf("--output-last-message") + 1;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        args[outputIndex],
        JSON.stringify({
          candidateId: "route-2",
          confidence: "high",
          reason: "搭車能大幅縮短步行與全程時間。",
        }),
      );
    },
  });

  assert.equal(result.candidateId, "route-2");
  assert.equal(result.confidence, "high");
});
