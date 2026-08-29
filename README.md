# 牽手過路走

為生活在台灣的視障者與高齡者打造的在地生活資訊助手。產品先從一件事做好：把交通、到站與天氣整理成可讀、可聽、可追溯的行前摘要。

目前是可執行的產品骨架。設定官方金鑰後，到站資訊可讀取 TDX、天氣可讀取中央氣象署；行程路線仍是明確標示的開發情境資料，尚不能用於實際出行。

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
- TDX OAuth token 快取、臺北市公車到站 adapter（資料快取 30 秒）。
- 中央氣象署今明 36 小時縣市預報 adapter（資料快取 10 分鐘）。
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

`.env.local` 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 與 `CWA_API_KEY` 只在伺服器端讀取，不要加上 `NEXT_PUBLIC_`，也不要提交金鑰。兩組金鑰皆未設定時，介面會清楚顯示示範資料；若已設定官方服務但查詢失敗，介面會顯示 unavailable，不會悄悄退回示範值。

目前官方資料範圍：

- 到站：以站名關鍵字查詢臺北市公車，仍須由使用者確認站牌方向。
- 天氣：中央氣象署 `F-C0032-001` 縣市層級今明 36 小時預報，不代表街道現場狀況。
- 行程：仍是開發情境資料；TDX 到站 API 不能取代完整路徑規劃。

## 驗證

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

瀏覽器 smoke test 需要 Python Playwright 與本機 Chromium／Chrome。先啟動 production server：

```bash
node node_modules/next/dist/bin/next start -p 3100
python tests/e2e_smoke.py
python tests/acceptance_audit.py
```

驗收報告與截圖會輸出到 `tmp/acceptance-audit/`；自動化只能驗證模擬 viewport 與 DOM／焦點狀態，不能宣稱已完成實體手機、真人螢幕閱讀器、實際語音內容或原生 WebMCP runtime 測試。

## 下一步

1. 接上真正的無障礙路徑規劃與更完整的全臺站牌／方向解析。
2. 加入 API rate limit、監控與上游異常告警。
3. 建立 OpenAI Realtime WebRTC 語音外殼，但不讓它阻塞 WebMCP 與手動 UI。
4. 用支援原生 WebMCP 的瀏覽器 runtime 做真實 smoke test。
5. 與視障者及無障礙專業者進行實體手機、NVDA／VoiceOver／TalkBack 使用測試。

## 安全邊界

本產品提供生活資訊，不替使用者判斷何時可以過馬路，也不取代白手杖、導盲犬、定向行動訓練或緊急服務。
