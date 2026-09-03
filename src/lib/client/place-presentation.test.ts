import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "@/lib/domain/journey";
import { presentPlaceCandidate } from "@/lib/client/place-presentation";

function candidate(
  overrides: Partial<PlaceCandidate> = {},
): PlaceCandidate {
  return {
    id: "place:1",
    name: "測試地點",
    description: "新北市・測試路1號",
    latitude: 25,
    longitude: 121.5,
    kind: "landmark",
    source: "OpenStreetMap",
    city: "NewTaipei",
    stopUid: null,
    ...overrides,
  };
}

describe("presentPlaceCandidate", () => {
  it("將公車站地址、方向與來源拆成一致的白話欄位", () => {
    expect(
      presentPlaceCandidate(
        candidate({
          name: "小白宮(淡水分局)",
          description: "臺北市・中正路334號(向東)",
          kind: "transit-stop",
          source: "TDX",
          city: "Taipei",
        }),
      ),
    ).toEqual({
      name: "小白宮（淡水分局）",
      kind: "公車站",
      location: "臺北市・中正路 334 號",
      direction: "往東",
      source: "公車站官方資料",
    });
  });

  it("地址文字包含完整行政區時不採用矛盾的城市代碼", () => {
    expect(
      presentPlaceCandidate(
        candidate({
          name: "北淡水",
          description: "臺北市・新北市淡水區(向南)",
          kind: "transit-stop",
          source: "TDX",
          city: "Taipei",
        }),
      ).location,
    ).toBe("新北市淡水區");
  });

  it("將地圖地址改成臺灣常用的行政區到門牌順序", () => {
    expect(
      presentPlaceCandidate(
        candidate({
          name: "淡水",
          description:
            "淡水, 1, 中正路, 草東里, 淡水區, 滬尾, 新北市, 25158, 臺灣",
          kind: "station",
        }),
      ),
    ).toEqual({
      name: "淡水",
      kind: "車站",
      location: "新北市淡水區・中正路 1 號",
      direction: null,
      source: "OpenStreetMap 地圖資料",
    });
  });
});
