# 牽手過路走

為生活在台灣的視障者與高齡者打造的在地生活資訊助手。產品先從一件事做好：把交通、到站與天氣整理成可讀、可聽、可追溯的行前摘要。

目前是可執行的產品骨架。交通與天氣使用明確標示的開發情境資料，尚不能用於實際出行。

## 核心原則

- 視障優先，也服務高齡者。
- Voice-first，不是 voice-only。
- 未知就說未知，不把資料缺口包裝成安全保證。
- 人類 UI 與 WebMCP Agent tools 共用同一套 Domain Services。
- 產品價值與使用者安全高於競賽需求。

完整產品決策見 [`docs/product-foundation.md`](docs/product-foundation.md)。
目標使用者驗證流程見 [`docs/usability-test-plan.md`](docs/usability-test-plan.md)。

## 已完成

- Next.js、React、TypeScript 應用骨架。
- 起點、目的地與少步行／少轉乘／無階梯偏好。
- 可朗讀的行程結果與清楚的開發資料標示。
- `plan_accessible_trip`、`get_vehicle_arrivals`、`get_weather_safety_brief` 三個 WebMCP imperative tools。
- WebMCP 不可用時保留完整手動操作。
- 鍵盤焦點、skip link、live region、reduced motion 與手機版面。
- Domain unit tests 與桌面／手機 Playwright smoke tests。

## 本機執行

需求：Node.js 22+、pnpm 11+。

```bash
corepack pnpm install
corepack pnpm dev
```

開啟 `http://localhost:3000`。

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
```

## 下一步

1. 建立 TDX 與中央氣象署 server-side adapters。
2. 加入來源 freshness、cache、timeout 與 unavailable 狀態。
3. 讓台灣地址、站牌與地名可以被可靠解析。
4. 建立 OpenAI Realtime WebRTC 語音外殼，但不讓它阻塞 WebMCP 與手動 UI。
5. 與視障者及無障礙專業者進行實際使用測試。

## 安全邊界

本產品提供生活資訊，不替使用者判斷何時可以過馬路，也不取代白手杖、導盲犬、定向行動訓練或緊急服務。
