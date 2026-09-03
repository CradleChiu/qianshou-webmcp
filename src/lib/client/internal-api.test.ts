import { describe, expect, it } from "vitest";
import { internalApiPath } from "./internal-api";

describe("internal API paths", () => {
  it("keeps requests relative to the application origin", () => {
    expect(internalApiPath("/", "journey")).toBe("/api/journey");
    expect(internalApiPath("/journey", "analytics")).toBe(
      "/journey/api/analytics",
    );
    expect(internalApiPath("/journey/", "journey")).toBe(
      "/journey/api/journey",
    );
  });

  it("rejects paths that could change URL authority", () => {
    expect(() => internalApiPath("//attacker.example", "journey")).toThrow();
    expect(() => internalApiPath("/journey?next=//attacker", "journey")).toThrow();
    expect(() => internalApiPath(`/${"-".repeat(300)}`, "journey")).toThrow();
  });
});
