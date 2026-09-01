# 正式執行資料政策

## 原則

正式功能不得以固定案例資料產生或補齊地點、座標、路線、班次、到站分鐘、天氣或無障礙結論。上游資料缺少或失敗時，必須回傳 `unavailable`／`partial` 與限制，不能換成看似可用的示範答案。

## 允許的常數

- 官方 API URL、資料集 ID、欄位名稱與城市代碼對照。
- 產品規則，例如最多轉乘次數、查詢半徑、逾時與快取時間。
- GTFS／TDX／CWA／OpenStreetMap／OTP 的資料格式與運具名稱對照。
- UI 文案、驗證訊息與無障礙資訊的誠實限制。
- `*.test.*` 中與 production bundle 隔離的測試 fixture。

## 禁止的資料

- 內建常用地點、別名及真實座標表。
- 固定轉乘站、固定公車／捷運路線或特定案例答案。
- 固定到站分鐘、天氣內容或無障礙狀態。
- 缺少官方金鑰或上游失敗時使用的示範行程。

## 正式資料流

- 地點：使用者／裝置提供的座標、TDX 站點、OpenStreetMap Nominatim。
- 路線與轉乘：OpenTripPlanner graph 內的 TDX／TRTC GTFS 與 OpenStreetMap。
- 到站：TDX 官方即時資料，且與 OTP 第一段行程識別碼綁定。
- 天氣：中央氣象署官方短時預報。

`runtime-data-policy.test.ts` 會掃描完整 production `src` 與 intent backend，阻止固定地點、座標、路線與答案重新進入正式執行路徑。
