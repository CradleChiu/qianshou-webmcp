import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeRoots = [
  "src",
  "services/intent-backend",
];

const forbiddenRuntimePatterns = [
  { label: "開發示範資料來源", pattern: /development-fixture/u },
  { label: "內建地點資料表", pattern: /\bknownPlaces\b/u },
  { label: "內建地點來源", pattern: /source\s*:\s*["']known["']/u },
  {
    label: "固定真實世界座標",
    pattern: /(?:latitude|longitude)\s*:\s*(?:2[0-6]|11[89]|12[0-3])\.\d{4,}/u,
  },
  {
    label: "固定 canonical 地點",
    pattern: /canonicalName\s*:\s*["'][^"']+["']/u,
  },
  {
    label: "固定路線答案",
    pattern: /routeName\s*:\s*["'][^"']+["']/u,
  },
  {
    label: "固定到站分鐘答案",
    pattern: /minutes\s*:\s*\d+/u,
  },
];

function runtimeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeFiles(path);
    if (!/\.(?:ts|tsx|mjs)$/u.test(entry.name)) return [];
    if (/\.(?:test|spec)\./u.test(entry.name)) return [];
    return [path];
  });
}

describe("runtime data policy", () => {
  it("正式決策程式不包含固定案例、地點、座標或答案", () => {
    const violations = runtimeRoots.flatMap((root) =>
      runtimeFiles(root).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return forbiddenRuntimePatterns
          .filter(({ pattern }) => pattern.test(source))
          .map(({ label }) => `${relative(process.cwd(), path)}：${label}`);
      }),
    );

    expect(violations).toEqual([]);
  });
});
