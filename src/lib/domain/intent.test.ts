import { describe, expect, it } from "vitest";
import { journeyDestinationQuery } from "./intent";

describe("journey intent", () => {
  it("anchors a relative destination to the understood origin", () => {
    expect(
      journeyDestinationQuery({
        origin: "台北車站",
        destination: "便利商店",
        destinationReference: "origin",
      }),
    ).toBe("台北車站附近的便利商店");
  });

  it("keeps a named destination unchanged", () => {
    expect(
      journeyDestinationQuery({
        origin: "台北車站",
        destination: "台大醫院",
        destinationReference: null,
      }),
    ).toBe("台大醫院");
  });
});
