import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlaceSelectionPrompt,
  selectPlaceCandidate,
  validatePlaceSelectionRequest,
  validatePlaceSelectionResult,
} from "./place-selection.mjs";

const request = {
  query: "動物園",
  candidates: [
    {
      id: "venue",
      name: "動物園",
      kind: "landmark",
      description: "動物園園區",
    },
    {
      id: "station",
      name: "動物園站",
      kind: "station",
      description: "鄰近動物園的車站",
    },
  ],
};

test("validates a bounded place-selection request", () => {
  assert.deepEqual(validatePlaceSelectionRequest(request), request);
});

test("place-selection prompt separates untrusted candidates and venue intent", () => {
  const prompt = buildPlaceSelectionPrompt(request);
  assert.match(prompt, /不可信的既有候選/);
  assert.match(prompt, /一般場所名稱優先理解為場所本身/);
  assert.match(prompt, /不可創造候選/);
});

test("rejects an invented candidate id", () => {
  assert.throws(
    () =>
      validatePlaceSelectionResult(
        { candidateId: "invented", confidence: "high", reason: "猜測" },
        new Set(["venue", "station"]),
      ),
    /不存在/,
  );
});

test("runs an isolated low-reasoning Codex selection", async () => {
  const result = await selectPlaceCandidate(request, {
    runner: async (args) => {
      assert.ok(args.includes('model_reasoning_effort="low"'));
      const outputIndex = args.indexOf("--output-last-message") + 1;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        args[outputIndex],
        JSON.stringify({
          candidateId: "venue",
          confidence: "high",
          reason: "文字指的是場所本身。",
        }),
      );
    },
  });

  assert.equal(result.candidateId, "venue");
  assert.equal(result.confidence, "high");
});
