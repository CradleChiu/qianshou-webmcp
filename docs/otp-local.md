# OpenTripPlanner 雙北試行環境

目前的真實路線垂直切片使用 OpenTripPlanner 2.9.0，輸入資料為：

- TDX 臺北捷運（TRTC）靜態 GTFS：需用 TDX OAuth token 下載。
- TDX 全臺靜態 GTFS：下載後只保留 `TPE`、`NWT` 前綴的臺北市與新北市公車資料。
- OpenStreetMap Taiwan PBF：由 Geofabrik 提供鏡像，下載後依雙北 GTFS 實際站點範圍裁切；使用資料時須標示 `© OpenStreetMap contributors`。

TDX 現行全臺 GTFS 端點為 `/api/gtfs/V3/Map/GTFS/Static`。舊版的臺北市與新北市個別 URL 已失效，不再使用。全臺原始 ZIP 同時含其他運具，其中部分 rail station entrance 會參照未提供的 `levels.txt`；直接交給 OTP 2.9 會建圖失敗。因此 `filter-double-taipei-bus-gtfs.ps1` 只輸出雙北公車所需的核心 GTFS 表，原始全臺 ZIP 不會被 OTP 載入。

實測裁切結果包含 2,592 routes、61,739 stops、79,358 trips 與 2,822,272 stop-time rows。OTP 2.9 已成功驗證並插值這些 trips；這與 TDX Bus `Schedule` API 每筆只有起站時間、無法單獨轉成 GTFS 的情況不同。

## 建置與啟動

先確認 Docker Desktop 已啟動，且專案根目錄 `.env.local` 已有 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET`：

```powershell
& .\infra\otp\fetch-data.ps1
& .\infra\otp\build-graph.ps1
docker compose -f .\infra\otp\docker-compose.yml up -d
```

`crop-osm.ps1` 會讀取兩份 GTFS 的 `stops.txt`，以最外圍站點加上 0.05 度（約 5 公里）邊界裁切 OSM。2026-08-31 實測把 326 MB 全臺 PBF 降為 110 MB，graph 由約 939 MB 降為 96.6 MB；street graph 由 1,497,329 vertices／3,916,081 edges 降為 416,129 vertices／1,148,080 edges，同時保留 61,982 stops 與 1,652 patterns。

`build-config.json` 只預算產品實際使用的「少走路＋wheelchair」stop-to-stop transfer。`router-config.json` 不在啟動時預填整張圖的 RAPTOR cache；`otp-config.json` 啟用 `OnDemandRaptorTransfer`，在實際區域查詢時才計算。正式容器使用 2 GiB Java heap、3 GiB cgroup 上限與 1 GiB reservation；實際路線查詢後約使用 1.3–1.5 GiB，載圖至可服務約 31 秒。

`build-graph.ps1` 在缺少 `double-taipei.osm.pbf` 時會自動執行 `crop-osm.ps1`。裁切工具以 `infra/otp/osmium/Dockerfile` 建立可重現的 `osmium-tool` 容器，不要求 Windows 預先安裝 osmium。

`fetch-data.ps1` 會：

1. 驗證或下載 TRTC GTFS。
2. 驗證或下載 Geofabrik Taiwan OSM PBF。
3. 下載 TDX 全臺 GTFS，驗證必要檔案與 ZIP 完整性。
4. 裁切成 `data/gtfs_tdx_double_taipei.zip`。
5. 預設刪除大型全臺 GTFS 來源檔；加上 `-KeepNationalArchive` 可保留。全臺 OSM 會保留作為下一次依 GTFS 邊界重裁切的來源。

大型 TDX 下載若中斷會刪除 `.part` 並從頭重試，避免把截斷 ZIP 當成有效資料。可用 `-DownloadAttempts 1..6` 調整次數；`-Force` 會重新下載全部資料。

確認 GraphQL：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/otp/gtfs/v1 -ContentType application/json -Body '{"query":"{ routes { shortName mode } }"}'
```

Next.js 預設連到 `http://127.0.0.1:8080/otp/gtfs/v1`，也可用 `OTP_GRAPHQL_URL` 覆寫。

## 資料特性與安全限制

- 常用地點會直接解析；其他雙北地址、地標與站點由 TDX 站點及 OpenStreetMap Nominatim 搜尋。使用者確認同名候選後，系統才把座標交給 OTP，畫面仍顯示人類可讀名稱。
- 公車 trip 有完整站序，但很多中間站沒有官方精確時刻；OTP 會在已知時間點之間插值。
- 公車 GTFS 目前沒有可用的 `shapes.txt`，公車腿仍可規劃，但地圖線形可能只是站點間連線。後續應由 TDX Bus Shape API 補齊。
- 靜態 GTFS 不含臨時停駛、延誤、電梯故障、施工與街道現場障礙。TDX 動態到站目前仍是獨立資料，尚未回寫 OTP 行程時間。
- `需要無階梯動線` 會啟用 OTP wheelchair preference，並預先建立 wheelchair transfer；這只是依已標記資料增加避讓成本。
- 少轉乘不是「一律禁止轉乘」。OTP 可多考慮 1 次轉乘，後端以總時間、步行負擔與每次轉乘約 10 分鐘的負擔共同排序；明顯更短、少走的捷運轉乘可勝過耗時的直達公車。
- OTP 官方文件明確指出，GTFS 的無障礙資料可能不完整；未知值不能解讀為無障礙。
- 路線結果是 OTP 整合 TDX GTFS 與 OpenStreetMap 的計算結果，不是 TDX 或營運單位發布的安全建議。

參考：[OTP GTFS GraphQL API](https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/)、[OTP accessibility](https://docs.opentripplanner.org/en/latest/Accessibility/)、[OTP 2.9 build configuration](https://docs.opentripplanner.org/en/v2.9.0/BuildConfiguration/)、[OTP 2.9 router configuration](https://docs.opentripplanner.org/en/v2.9.0/RouterConfiguration/)、[GTFS stop times](https://gtfs.org/documentation/schedule/reference/#stop_timestxt)、[Geofabrik Taiwan](https://download.geofabrik.de/asia/taiwan.html)、[TDX API 文件](https://tdx.transportdata.tw/api-service/swagger)。
