# OpenTripPlanner 臺北試行環境

目前的真實路線垂直切片使用 OpenTripPlanner 2.9.0，輸入資料為：

- TDX 臺北捷運（TRTC）靜態 GTFS：需用 TDX OAuth token 下載。
- OpenStreetMap Taiwan PBF：由 Geofabrik 提供鏡像；使用資料時須標示 `© OpenStreetMap contributors`。
- 選填的雙北公車 GTFS：分別以 `TDX_GTFS_TAIPEI_BUS_URL`、`TDX_GTFS_NEWTAIPEI_BUS_URL` 指定，不在程式碼中猜測或固定已失效的 URL。

TDX 舊版 `/api/premium/v2/GTFS/Static/Bus/City/Taipei/gtfs` 與推測的 V3 雙北公車 GTFS 路徑，已在 2026-08-29 實測為 HTTP 404；TRTC 的 `/api/gtfs/V3/Map/GTFS/Static/Rail/TRTC` 則回傳有效 ZIP。因此預設 graph 只有捷運，公車到站仍由既有 TDX Bus API 獨立呈現，不能充當 OTP 班表。

TDX Bus `Schedule` 也不能直接轉為完整 GTFS：臺北市 599 筆 schedule records 中有 546 筆 `Timetables`，新北市 963 筆中有 835 筆；但全量轉換的 72,564 個 timetable 沒有一筆形成至少兩站的 stop-time sequence，抽樣資料只含起站一筆發車時間。GTFS 即使採 `frequencies.txt`，仍需要一組完整 stop-time template；本專案不以平均車速或猜測時間補值。

## 建置與啟動

先確認 Docker Desktop 已啟動，且專案根目錄 `.env.local` 已有 TDX 憑證：

```powershell
& .\infra\otp\fetch-data.ps1
& .\infra\otp\build-graph.ps1
docker compose -f .\infra\otp\docker-compose.yml up -d
```

確認 GraphQL：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/otp/gtfs/v1 -ContentType application/json -Body '{"query":"{ routes { shortName mode } }"}'
```

Next.js 預設連到 `http://127.0.0.1:8080/otp/gtfs/v1`，也可用 `OTP_GRAPHQL_URL` 覆寫。

## 試行範圍與安全限制

- 地點解析支援臺北車站、臺大醫院、市政府，或臺灣範圍內的 `緯度,經度`。
- `需要無階梯動線` 會啟用 OTP wheelchair preference，並預先建立 wheelchair transfer；這只是依已標記資料增加避讓成本。
- OTP 官方文件明確指出，GTFS 的無障礙資料可能不完整；未知值不能解讀為無障礙。
- 靜態 GTFS 不含臨時停駛、延誤、電梯故障、施工與街道現場障礙。
- 若要加入公車，優先向 TDX 或雙北主管機關取得帳號實際可用的現行 GTFS URL，分別填入兩個環境變數；替代來源必須另行核對授權、逐站時間、涵蓋範圍與更新時間後才能併入 graph。
- 若拿不到完整 GTFS，安全替代方案是維持「OTP 捷運＋步行」與「TDX 公車即時到站」分離，或採購能合法提供雙北 transit routing 的服務；不能把到站預估或班距資料偽裝成靜態班表。

參考：[OTP GTFS GraphQL API](https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/)、[OTP accessibility](https://docs.opentripplanner.org/en/latest/Accessibility/)、[OTP build configuration](https://docs.opentripplanner.org/en/latest/BuildConfiguration/)、[Geofabrik Taiwan](https://download.geofabrik.de/asia/taiwan.html)、[TDX API 文件](https://tdx.transportdata.tw/api-service/swagger)。
