import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "@/lib/domain/journey";
import { mergePlaceCandidates } from "./place-candidates";

function candidate(
  id: string,
  name: string,
  latitude: number,
  kind: PlaceCandidate["kind"] = "landmark",
): PlaceCandidate {
  return {
    id,
    name,
    description: `${name}的測試位置`,
    latitude,
    longitude: 121.5,
    kind,
    source: kind === "transit-stop" ? "TDX" : "OpenStreetMap",
    city: "Taipei",
    stopUid: null,
  };
}

describe("mergePlaceCandidates", () => {
  it("合併鄰近場所別名，但保留會改變下車點的交通站", () => {
    const result = mergePlaceCandidates("動物園", [
      candidate("station", "捷運動物園站", 25, "station"),
      candidate("generic-a", "動物園", 25.001),
      candidate("generic-b", "動物園", 25.003),
      candidate("official-name", "某城市立動物園", 25.002),
    ]);

    expect(result.map(({ id }) => id)).toEqual(["station", "official-name"]);
  });

  it("不合併相距較遠的同名場所", () => {
    const result = mergePlaceCandidates("圖書館", [
      candidate("branch-a", "圖書館", 25),
      candidate("branch-b", "圖書館", 25.01),
    ]);

    expect(result).toHaveLength(2);
  });

  it("即使同名且相鄰，也不把交通站與場所本身混為一個目的地", () => {
    const result = mergePlaceCandidates("展覽館", [
      candidate("venue", "展覽館", 25),
      candidate("station", "展覽館", 25.0001, "station"),
    ]);

    expect(result).toHaveLength(2);
  });

  it("同一站體的 OSM 車站節點可合併", () => {
    const result = mergePlaceCandidates("中央車站", [
      candidate("building", "中央車站", 25, "station"),
      candidate("platform-node", "中央車站", 25.003, "station"),
    ]);

    expect(result).toHaveLength(1);
  });

  it("不把鐵路或捷運站體與附近公車站牌合併", () => {
    const result = mergePlaceCandidates("中央車站", [
      candidate("rail-station", "中央車站", 25, "station"),
      candidate("bus-stop", "中央車站", 25.0001, "transit-stop"),
    ]);

    expect(result).toHaveLength(2);
  });

  it("合併同一地物的近距離重複節點", () => {
    const result = mergePlaceCandidates("河濱公園", [
      candidate("node-a", "河濱公園", 25),
      candidate("node-b", "河濱公園", 25.002),
    ]);

    expect(result).toHaveLength(1);
  });

  it("有多個名稱相關候選時排除完全無關的搜尋雜訊", () => {
    const result = mergePlaceCandidates("山城", [
      candidate("visitor-center", "山城遊客中心", 25),
      candidate("old-street", "山城老街", 25.001),
      candidate("noise", "海濱公園", 25.002),
    ]);

    expect(result.map(({ id }) => id)).toEqual([
      "visitor-center",
      "old-street",
    ]);
  });
});
