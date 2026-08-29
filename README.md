# 牽手過路走

為生活在台灣的視障者與高齡者打造的在地生活資訊助手。產品先從一件事做好：把交通、到站與天氣整理成可讀、可聽、可追溯的行前摘要。

目前是可執行的雙北試行版。設定官方金鑰後，到站資訊可讀取 TDX、天氣可讀取中央氣象署；行程路線改由 OpenTripPlanner 整合 TDX GTFS 與 OpenStreetMap 計算。OTP 未啟動或地點不在試行範圍時會回傳 unavailable，不再以固定示範行程代替。

## 核心原則

- 視障優先，也服務高齡者。
- Voice-first，不是 voice-only。
- 未知就說未知，不把資料缺口包裝成安全保證。
- 人類 UI 與 WebMCP Agent tools 共用同一個 server-side journey API。
- 產品價值與使用者安全高於競賽需求。

完整產品決策見 [`docs/product-foundation.md`](docs/product-foundation.md)。
目標使用者驗證流程見 [`docs/usability-test-plan.md`](docs/usability-test-plan.md)。

## 已完成

- Next.js、React、TypeScript 應用骨架。
- 起點、目的地與少步行／少轉乘／無階梯偏好。
- 可朗讀的行程結果，以及逐項呈現官方／示範、資料時間、取得時間、新鮮度與限制。
- `plan_accessible_trip`、`get_vehicle_arrivals`、`get_weather_safety_brief` 三個 WebMCP imperative tools。
- WebMCP 不可用時保留完整手動操作。
- 鍵盤焦點、skip link、live region、reduced motion 與手機版面。
- TDX OAuth token 快取、失效 token 單次重新驗證，以及臺北／新北公車到站 adapter（資料快取 30 秒）。OTP 公車路段會以 `StopUID + RouteUID + Direction` 精確綁定 TDX 到站；純步行或非公車路段不會混入附近公車。
- 中央氣象署雙北鄉鎮逐 3 小時預報 adapter，只整理目前與下一時段、涵蓋未來約 3–6 小時（資料快取 10 分鐘）。
- OpenTripPlanner 2.9 `planConnection` adapter，傳遞少步行、少轉乘與 wheelchair preference。
- TDX 臺北捷運 GTFS、全臺 GTFS 中的臺北／新北公車資料，以及 Geofabrik OpenStreetMap 的下載、裁切、建圖與 Docker Compose 設定。
- 上游 timeout、錯誤與 unavailable 狀態；官方模式失敗時不以示範資料冒充。
- Domain／adapter unit tests 與桌面／手機 Playwright smoke tests。

## 本機執行

需求：Node.js 22+、pnpm 11+。

```bash
corepack pnpm install
Copy-Item .env.example .env.local
corepack pnpm dev
```

開啟 `http://localhost:3000`。

真實路線另須先建立並啟動本機 OTP；完整步驟見 [`docs/otp-local.md`](docs/otp-local.md)。最短流程：

```powershell
& .\infra\otp\fetch-data.ps1
& .\infra\otp\build-graph.ps1
docker compose -f .\infra\otp\docker-compose.yml up -d
```

`.env.local` 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 與 `CWA_API_KEY` 只在伺服器端讀取，不要加上 `NEXT_PUBLIC_`，也不要提交金鑰。兩組金鑰皆未設定時，到站與天氣會清楚顯示示範資料；OTP 或官方服務查詢失敗時，介面會顯示 unavailable，不會悄悄退回固定值。

如果由受限的 Agent 沙箱啟動 Next.js，必須允許該伺服器連線外部網路，否則 TDX 與中央氣象署會明確回傳無法連線；本機 OTP 不受此外部網路限制。

目前官方資料範圍：

- 到站：以站名關鍵字查詢臺北市與新北市公車，仍須由使用者確認站牌方向。
- 天氣：中央氣象署 `F-D0047-061`（臺北市）與 `F-D0047-069`（新北市）鄉鎮逐 3 小時預報；摘要只涵蓋未來約 3–6 小時。只輸入縣市時分別以中正區／板橋區為代表並明確標示，不代表街道現場狀況。
- 行程：OTP 試行地點包含臺北車站、臺大醫院、市政府、板橋車站，也接受臺灣範圍內的明確座標；預設 graph 含臺北捷運及臺北／新北公車 GTFS。
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

驗收報告與截圖會輸出到 `tmp/acceptance-audit/`；自動化只能驗證模擬 viewport 與 DOM／焦點狀態，不能宣稱已完成實體手機、真人螢幕閱讀器、實際語音內容或原生 WebMCP runtime 測試。

## 下一步

1. 依 [`docs/usability-test-plan.md`](docs/usability-test-plan.md) 與 3–5 位視障者進行實體手機、NVDA／VoiceOver／TalkBack 使用測試。
2. 先修正測試發現的 P0／P1 問題，並用支援原生 WebMCP 的瀏覽器 runtime 做真實 smoke test。
3. 根據參與者實際用詞與操作策略，擴充地點別稱、站牌與方向解析。
4. 加入 OTP 健康檢查、API rate limit、監控與上游異常告警。
5. 通過第一輪使用者驗證後，再評估 TDX Bus Shape、動態到站與 OTP 靜態行程整合。
6. 最後建立 OpenAI Realtime WebRTC 語音外殼，不讓它阻塞 WebMCP 與手動 UI。

在第一輪目標使用者驗證與 P0 修正完成前，暫不擴張更多縣市、運具或獨立資料庫。

## 安全邊界

本產品提供生活資訊，不替使用者判斷何時可以過馬路，也不取代白手杖、導盲犬、定向行動訓練或緊急服務。
