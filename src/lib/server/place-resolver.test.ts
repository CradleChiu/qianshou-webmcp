import { describe, expect, it } from "vitest";
import {
  normalizeTaiwanPlace,
  resolveDoubleTaipeiTransitPlace,
  resolveOtpPlace,
  resolveShortTermWeatherPlace,
  resolveWeatherCounty,
} from "./place-resolver";

describe("place resolver", () => {
  it("正規化台字、空白與站牌後綴", () => {
    expect(normalizeTaiwanPlace("  台北  車站 ")).toBe("臺北 車站");
    expect(resolveDoubleTaipeiTransitPlace("台北車站附近站牌")).toEqual({
      canonicalName: "臺北車站",
      city: "Taipei",
      countyName: "臺北市",
      stopKeyword: "臺北車站",
    });
  });

  it("接受雙北站名，但拒絕明確的外縣市", () => {
    expect(resolveDoubleTaipeiTransitPlace("臺北市衡陽路口")?.stopKeyword).toBe(
      "衡陽路口",
    );
    expect(resolveDoubleTaipeiTransitPlace("新北市板橋車站")).toEqual({
      canonicalName: "新北市板橋車站",
      city: "NewTaipei",
      countyName: "新北市",
      stopKeyword: "板橋車站",
    });
    expect(resolveDoubleTaipeiTransitPlace("桃園市桃園車站")).toBeNull();
  });

  it("只從明確縣市判斷天氣區域", () => {
    expect(resolveWeatherCounty("高雄市美麗島站")).toBe("高雄市");
    expect(resolveWeatherCounty("台大醫院")).toBeNull();
    expect(resolveWeatherCounty("不知道在哪裡")).toBeNull();
  });

  it("只在輸入含明確雙北行政區時解析短時預報位置", () => {
    expect(resolveShortTermWeatherPlace("台大醫院")).toBeNull();
    expect(resolveShortTermWeatherPlace("新北市板橋區")).toEqual({
      countyName: "新北市",
      districtName: "板橋區",
      isRepresentativeDistrict: false,
    });
    expect(resolveShortTermWeatherPlace("臺北市")).toBeNull();
    expect(resolveShortTermWeatherPlace("高雄市")).toBeNull();
  });

  it("不把地點名稱轉成內建座標", () => {
    expect(resolveOtpPlace("台北車站")).toBeNull();
    expect(resolveOtpPlace("臺北市政府")).toBeNull();
    expect(resolveOtpPlace("台北101")).toBeNull();
    expect(resolveOtpPlace("板橋車站")).toBeNull();
    expect(resolveOtpPlace("松山機場")).toBeNull();
  });

  it("接受臺灣範圍內的明確座標並拒絕範圍外座標", () => {
    expect(resolveOtpPlace("25.047, 121.517")).toMatchObject({
      latitude: 25.047,
      longitude: 121.517,
      coordinateSource: "user-coordinate",
    });
    expect(resolveOtpPlace("40.7,-74.0")).toBeNull();
  });
});
