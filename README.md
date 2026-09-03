# 牽手過路走

[English README](README.en.md)｜繁體中文

為生活在台灣的視障者與高齡者打造的在地生活資訊助手。產品先從一件事做好：把交通、到站與天氣整理成可讀、可聽、可追溯的行前摘要。

目前是可執行的雙北試行版。設定官方金鑰後，到站資訊可讀取 TDX、天氣可讀取中央氣象署；行程路線改由 OpenTripPlanner 整合 TDX GTFS 與 OpenStreetMap 計算。OTP 未啟動或地點不在試行範圍時會回傳 unavailable，不再以固定示範行程代替。

## 核心原則

- 視障優先，也服務高齡者。
- Voice-first，不是 voice-only。
- 未知就說未知，不把資料缺口包裝成安全保證。
- 人類 UI 與 WebMCP Agent 共用同一條 server-side 行程準備流程。
- 產品價值與使用者安全高於競賽需求。

完整產品決策見 [`docs/product-foundation.md`](docs/product-foundation.md)。
目標使用者驗證流程見 [`docs/usability-test-plan.md`](docs/usability-test-plan.md)。
無障礙資料現況與對外用語判準見 [`docs/accessibility-data-coverage.md`](docs/accessibility-data-coverage.md)。

## 已完成

- Next.js、React、TypeScript 應用骨架。
- 單一自然語言行程入口；使用者只說「我想去台北101」時，頁面會請求一次性定位並以目前位置出發。拒絕、逾時或誤差超過 250 公尺時會保留目的地，只追問附近地標。
- 固定採用少走路、少轉乘、避開資料中已知階梯的規劃原則，不要求目標使用者自行理解或勾選技術性偏好。
- 路線硬性限制最多 2 次轉乘；OTP 先產生真實候選，長距離純步行時會再尋找可銜接的大眾運輸方案，再由受限制的 Codex 路線選擇 Agent 比較總時間、步行與轉乘。Agent 只能回傳既有候選 ID，失敗時回到確定性排序。
- 同機、loopback-only 的 Codex CLI 意圖服務：結構化輸出、60 秒逾時、同時最多 2 筆；關閉 shell、瀏覽器、外掛與多 Agent，採唯讀、ephemeral 執行。
- 可朗讀的行程結果，以及逐項呈現官方／示範、資料時間、取得時間、新鮮度與限制。
- 單一 `prepare_accessible_journey` WebMCP tool：起點可省略，頁面會另行取得使用者定位授權；工具回傳給 Agent 時不包含目前位置的精確經緯度。系統會自行完成地點解析、路線、精確到站與短時天氣；同名地點一定先交由使用者確認。
- 主要畫面與朗讀只使用日常行程語言；OTP、GTFS、TDX 等實作與來源細節保留在可展開的「資料來源與目前限制」。
- WebMCP 不可用時保留完整的單一自然語言操作，不退回要求精準拆分起點與目的地的表單。
- 鍵盤焦點、skip link、live region、reduced motion 與手機版面。
- TDX OAuth token 快取、失效 token 單次重新驗證，以及臺北／新北公車到站與臺北捷運 LiveBoard adapter。OTP 公車路段會以 `StopUID + RouteUID + Direction` 精確綁定；捷運會把月臺代碼、路線與目的地方向精確對到 TRTC 進站資料；純步行與其他運具不會混入附近公車。
- TDX 雙北公車站＋OpenStreetMap Nominatim 地點搜尋；只在使用者送出時查詢，不做逐字自動完成。公共 Nominatim 查詢限制為每秒 1 次並快取 24 小時，同名候選會先顯示地址與來源供使用者選擇。
- OTP street graph 只保留雙北 GTFS 站點外圍約 5 公里的 OSM；graph 約 96.6 MB，正式容器限制為 2 GiB Java heap／3 GiB 記憶體上限，避免全臺街道圖占用 VM 記憶體。
- 中央氣象署雙北鄉鎮逐 3 小時預報 adapter，只整理目前與下一時段、涵蓋未來約 3–6 小時（資料快取 10 分鐘）。
- OpenTripPlanner 2.9 `planConnection` adapter，傳遞少步行、少轉乘與 wheelchair preference；只有同批候選都有分數且被選方案嚴格較高時才說「依目前已標記資料，相對較適合」，其餘一律標示無障礙狀況未知。步行仍長時會主動警示，並提供最多三個可切換比較方案。
- TDX 臺北捷運 GTFS、全臺 GTFS 中的臺北／新北公車資料，以及 Geofabrik OpenStreetMap 的下載、裁切、建圖與 Docker Compose 設定。
- 上游 timeout、錯誤與 unavailable 狀態；官方模式失敗時不以示範資料冒充。
- Domain／adapter unit tests，以及桌面／手機／鍵盤／精簡朗讀／單一 WebMCP 流程的 Playwright smoke tests。

## 本機執行

需求：Node.js 22+、pnpm 11+、已登入的 Codex CLI。

```bash
corepack pnpm install
Copy-Item .env.example .env.local
```

終端一：

```bash
node services/intent-backend/server.mjs
```

終端二：

```bash
corepack pnpm dev
```

分別在兩個終端啟動意圖服務與 Next.js，然後開啟 `http://localhost:3000`。意圖服務只監聽 `127.0.0.1:8020`；使用者輸入會被視為不可信資料，Codex CLI 不會取得 shell、瀏覽器或專案寫入能力。

目前 VM 試行版部署於 `https://loveyou.cradle-ai.dev/journey`。Next.js 與 Codex CLI 意圖服務都在 `loveyou`，Next.js 透過 loopback 呼叫意圖服務；OTP 也只綁定 VM 的 `127.0.0.1:8080`，不直接暴露公網。

真實路線另須先建立並啟動本機 OTP；完整步驟見 [`docs/otp-local.md`](docs/otp-local.md)。最短流程：

```powershell
& .\infra\otp\fetch-data.ps1
& .\infra\otp\build-graph.ps1
docker compose -f .\infra\otp\docker-compose.yml up -d
& .\infra\otp\audit-accessibility-coverage.ps1
```

`.env.local` 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 與 `CWA_API_KEY` 只在伺服器端讀取，不要加上 `NEXT_PUBLIC_`，也不要提交金鑰。兩組金鑰皆未設定時，到站與天氣會清楚顯示示範資料；OTP 或官方服務查詢失敗時，介面會顯示 unavailable，不會悄悄退回固定值。

如果由受限的 Agent 沙箱啟動 Next.js，必須允許該伺服器連線外部網路，否則 TDX、OpenStreetMap 與中央氣象署會明確回傳無法連線；本機 OTP 不受此外部網路限制。

目前官方資料範圍：

- 到站：OTP 公車行程以站牌、路線與方向精確查詢臺北市／新北市公車；臺北捷運以 TDX TRTC LiveBoard 查詢列車正在進入月臺的狀態。TRTC 公開 LiveBoard 只回傳 `EstimateTime=0`，沒有完整的進站前分鐘倒數；畫面會把「目前未偵測到進站」與「服務失敗」分開，且不把前者解讀為沒有車。完整倒數屬臺北捷運會員專屬 API，另需提出申請。
- 天氣：中央氣象署 `F-D0047-061`（臺北市）與 `F-D0047-069`（新北市）鄉鎮逐 3 小時預報；摘要只涵蓋未來約 3–6 小時。只輸入縣市時分別以中正區／板橋區為代表並明確標示，不代表街道現場狀況。
- 地點：常用地點可直接解析；其他雙北地址、地標與站點會整合 TDX／OpenStreetMap 搜尋，確認候選後才把座標交給 OTP。介面與行程敘述保留地點名稱，不顯示原始座標。
- 目前位置：只透過瀏覽器 `getCurrentPosition` 取得一次，不使用背景追蹤；座標只送至同站 API 與 OTP 規劃這趟路，不送入 Codex CLI，也不儲存於資料庫。
- 使用紀錄：以瀏覽器工作階段 UUID 串起提問、意圖判讀與主要 UI／WebMCP 操作；資料庫保存使用者送出的原始提問、系統理解摘要與意圖分類，不保存未送出文字、語音原檔或瀏覽器定位 API 回傳的精確座標。若使用者在提問中自行輸入地址或座標，該內容會原樣保存。預設保存 30 天，使用者可停止記錄或刪除當次工作階段。
- 行程：OTP 接受地點搜尋確認後的座標；預設 graph 含臺北捷運及臺北／新北公車 GTFS。
- 無障礙覆蓋：雙北公車 GTFS 的 61,739 個站點與 79,358 個班次皆未提供輪椅欄位；臺北捷運 722 個站點／月臺節點中 523 個有明確標記、199 個未知，5,520 個班次皆有可用標記。兩份 feed 都沒有站內 `pathways.txt`／`levels.txt`，因此不能宣稱完整無階梯動線。
- 公車時刻：有完整站序，但部分中間站時間由 OTP 在官方時間點間插值；動態到站尚未回寫行程時間。
- 公車線形：目前 GTFS 未提供可用的 `shapes.txt`，行程可規劃，但地圖線形仍可能不精確。
- 路線來源：OTP 計算結果屬於「整合資料」，不是 TDX 或營運單位發布的建議路線；OpenStreetMap attribution 為 `© OpenStreetMap contributors`。

## 驗證

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
python tests/otp_multimodal_smoke.py
```

瀏覽器 smoke test 需要 Python Playwright 與本機 Chromium／Chrome。先啟動 production server：

```bash
node node_modules/next/dist/bin/next start -p 3100
python tests/e2e_smoke.py
python tests/acceptance_audit.py
```

也可對已部署頁面執行同一組 UI 測試：

```powershell
$env:E2E_BASE_URL='https://loveyou.cradle-ai.dev/journey'
python tests/e2e_smoke.py
```

驗收報告與截圖會輸出到 `tmp/acceptance-audit/`；自動化只能驗證模擬 viewport 與 DOM／焦點狀態，不能宣稱已完成實體手機、真人螢幕閱讀器、實際語音內容或原生 WebMCP runtime 測試。

## 下一步

1. 依 [`docs/usability-test-plan.md`](docs/usability-test-plan.md) 與 3–5 位視障者進行實體手機、NVDA／VoiceOver／TalkBack 使用測試。
2. 用支援原生 WebMCP 的 Codex／ChatGPT 內建 Browser 重測本次 P1：確認 Agent 能自然說明偏好衝突、捷運進站限制與替代方案，且同頁同步更新。
3. 向臺北捷運公司申請會員專屬「列車到站資訊」API；核准前維持 TDX LiveBoard 的誠實限制，不自行推算或偽裝完整倒數。
4. 建立 `search_nearby_places`：取得使用者明確授權的位置後，將「最近的捷運站／便利商店／無障礙廁所」解析成附近 POI；距離與 OSM `wheelchair`、`toilets:wheelchair` 缺值必須清楚標示未知。
5. 根據參與者實際用詞與操作策略，擴充地點別稱、候選排序、站牌與方向解析；正式公開部署前改用自架 Nominatim 或具 SLA 的地理編碼服務。
6. 依無障礙資料覆蓋報告補齊逐段障礙原因、OSM 標記統計與捷運電梯狀態；缺值維持未知，不以推測補齊。
7. 加入 OTP 健康檢查、API rate limit、監控與上游異常告警。
8. 通過第一輪使用者驗證後，再評估 TDX Bus Shape、動態到站與 OTP 靜態行程整合。
9. 最後建立 OpenAI Realtime WebRTC 語音外殼，不讓它阻塞 WebMCP 與手動 UI。

在第一輪目標使用者驗證與 P0 修正完成前，暫不擴張更多縣市、運具或獨立資料庫。

## 安全邊界

本產品提供生活資訊，不替使用者判斷何時可以過馬路，也不取代白手杖、導盲犬、定向行動訓練或緊急服務。

目前位置必須由瀏覽器取得使用者授權；只取一次、不背景追蹤、不存資料庫、不傳入 Codex CLI，WebMCP Agent 的回傳也會移除精確經緯度。
