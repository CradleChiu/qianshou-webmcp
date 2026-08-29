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

  it("從明確縣市或已知地標判斷天氣區域", () => {
    expect(resolveWeatherCounty("高雄市美麗島站")).toBe("高雄市");
    expect(resolveWeatherCounty("台大醫院")).toBe("臺北市");
    expect(resolveWeatherCounty("不知道在哪裡")).toBeNull();
  });

  it("把雙北地點解析成短時鄉鎮預報行政區", () => {
    expect(resolveShortTermWeatherPlace("台大醫院")).toEqual({
      countyName: "臺北市",
      districtName: "中正區",
      isRepresentativeDistrict: false,
    });
    expect(resolveShortTermWeatherPlace("新北市板橋區")).toEqual({
      countyName: "新北市",
      districtName: "板橋區",
      isRepresentativeDistrict: false,
    });
    expect(resolveShortTermWeatherPlace("臺北市")).toEqual({
      countyName: "臺北市",
      districtName: "中正區",
      isRepresentativeDistrict: true,
    });
    expect(resolveShortTermWeatherPlace("高雄市")).toBeNull();
  });

  it("以 TDX GTFS 站點座標解析 OTP 試行地點", () => {
    expect(resolveOtpPlace("台北車站")).toEqual({
      canonicalName: "臺北車站",
      latitude: 25.04631,
      longitude: 121.517415,
      coordinateSource: "tdx-gtfs-station",
    });
    expect(resolveOtpPlace("臺北市政府")?.longitude).toBe(121.565685);
    expect(resolveOtpPlace("板橋車站")).toMatchObject({
      canonicalName: "板橋車站",
      latitude: 25.015838,
      longitude: 121.462964,
      coordinateSource: "tdx-gtfs-station",
    });
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
