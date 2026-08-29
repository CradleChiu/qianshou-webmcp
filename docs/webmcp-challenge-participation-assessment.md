# 「牽手過路走」WebMCP Challenge 參賽規範與可行性評估

> 文件狀態：競賽決策與交付指引  
> 最後核對：2026-08-27（Asia/Taipei）  
> 適用競賽：[The WebMCP Challenge](https://openai.com/webmcp-challenge/)  
> 正式規則：[Devpost Official Rules](https://webmcp.devpost.com/rules)  
> 重要原則：本文件是實務整理；若與 Devpost 正式規則或最新公告衝突，以正式規則及主辦方書面說明為準。

## 執行摘要

「牽手過路走」可以參加 WebMCP Challenge，且題目與競賽要求的人類／Agent 共用網頁、真實使用者問題及非平凡 WebMCP 實作高度契合。

台灣列於 OpenAI API 支援地區，且不在正式規則明列的排除地區中。因此，在參賽者已達居住地法定成年年齡、沒有主辦或評審利益衝突等前提下，原則上具備資格。

競賽截止時間為：

- Devpost：2026-09-03 20:00 UTC。
- 美國太平洋時間：2026-09-03 13:00 PT。
- 台灣時間：**2026-09-04 04:00（UTC+8）**。

本專案截至 2026-08-27 只有技術研究文件，尚無可執行網站、公開程式碼倉庫、部署及示範影片。若限縮為競賽版 MVP，按時完成最低合規作品的可行性為中高；若同時追求全台資料、完整即時語音、戶外導航與生產級安全，則不適合本次期限。

建議決策：**參賽，但以 WebMCP 為主體、即時語音為非阻塞加分項。**

## 1. 參賽資格

### 1.1 台灣資格

正式規則要求個人居住地或組織所在地必須在 OpenAI API 支援國家／地區；台灣明列於支援清單，且不在競賽列舉的排除地區。

仍須符合：

- 個人已達其居住地法定成年年齡。
- 個人、團隊或組織沒有主辦方、管理方、評審或相關組織的利益衝突。
- 不屬於正式規則排除的員工、代理人、親屬、關係企業等身分。
- 當地法律未禁止參與或領取獎項。

來源：

- [OpenAI API supported countries and territories](https://platform.openai.com/docs/supported-countries)
- [WebMCP Challenge Official Rules：Eligibility](https://webmcp.devpost.com/rules)

### 1.2 參賽形式

- 可用個人、團隊或組織身分參加。
- 團隊或組織必須指定一位符合資格的 Representative。
- FAQ 表示團隊人數沒有上限。
- 獎品中的 ChatGPT Pro、紀念品等只涵蓋最多三名團隊成員；這是獎品範圍，不是團隊人數上限。
- 最保守的規則解讀是一名 Entrant 只提交一件作品。

## 2. 競賽時程

| 階段 | 太平洋時間 | UTC | 台灣時間 |
|---|---|---|---|
| Submission 截止 | 2026-09-03 13:00 PT | 2026-09-03 20:00 | **2026-09-04 04:00** |
| Judging 開始 | 2026-09-04 10:00 PT | 2026-09-04 17:00 | 2026-09-05 01:00 |
| Judging 結束 | 2026-09-21 17:00 PT | 2026-09-22 00:00 | 2026-09-22 08:00 |
| 預定公布得獎者 | 2026-09-23 14:00 PT | 2026-09-23 21:00 | 2026-09-24 05:00 |

來源：[Devpost Schedule](https://webmcp.devpost.com/details/dates)

### 2.1 內部截止

不要把正式截止當成工作截止。建議：

- 功能凍結：台灣時間 2026-09-02 晚間。
- 影片、英文材料、部署驗證完成：2026-09-03 18:00 前。
- Devpost 最後提交：2026-09-03 20:00 前。
- 保留至少八小時處理影片上傳、Devpost 表單、部署或登入問題。

## 3. 必須提交的內容

正式規則要求下列項目缺一不可。

### 3.1 可運作的 Live URL

- 評審必須能以 ChatGPT 桌面版內建瀏覽器，或啟用 WebMCP 的 Chrome 149+ 存取。
- 可以部署在 ChatGPT Sites、Cloudflare、Vercel、Render、Netlify、Shopify 或其他平台。
- 網站可以要求登入，但必須在 submission form 提供可用的評審帳號與測試說明。
- 評審測試必須免費，並在評審期結束前維持可用。
- 評審不一定實際操作網站，也可能只根據文字、圖片、程式碼與影片判斷。

### 3.2 專案文字說明

必須說明：

- 為何這個使用情境適合 WebMCP。
- WebMCP 如何改善使用者體驗。
- 人與 Agent 可以共同完成什麼以前困難或不可能的事情。
- WebMCP 的實作方式。

建議另行加入：

- 台灣在地資料來源及更新時間。
- 視障者／高齡者的具體困難，而不是只寫抽象社會影響。
- 無障礙與安全邊界。
- 實際可用功能與尚未完成部分，避免過度宣稱。

### 3.3 公開程式碼倉庫

Repository 必須：

- 位於 GitHub、GitLab 或 Bitbucket。
- 對外公開。
- 包含讓專案運作所需的原始碼、資產、安裝與執行說明。
- 包含可辨識的開源授權檔案，例如 `LICENSE`。
- 讓授權可被 repository 平台辨識並顯示在頁面上方。
- 在真正執行的程式碼中使用 WebMCP，例如 `document.modelContext.registerTool(...)`，不能只在 README 貼一段範例。
- 不得提交 API key、密碼、評審帳號或其他 secrets。

建議至少包含：

```text
README.md
LICENSE
.env.example
docs/
src/
tests/
```

### 3.4 公開 Demo 影片

- 少於三分鐘；評審沒有義務觀看超過三分鐘的部分。
- 上傳至 YouTube 並公開可見。
- 必須清楚示範作品實際運作。
- 必須包含聲音，說明做了什麼及如何使用 WebMCP。
- 不得使用未獲授權的音樂、商標或著作權素材。
- 若影片不是英文，必須提供完整英文翻譯；最實際的做法是加入英文字幕。

### 3.5 語言

所有 submission materials 必須是英文；若保留繁體中文介面或中文旁白，至少要為下列內容提供英文版本：

- Demo 影片。
- 專案介紹。
- README 與測試指引。
- 提交表單中的其他材料。

繁體中文產品介面本身可以保留，這反而是台灣在地化特色，但評審材料不能只有中文。

## 4. 新作品與既有作品

作品必須符合其中一項：

1. 在 Submission Period 期間新建。
2. 既有專案在 2026-08-25 競賽開始後，以 WebMCP 進行具實質性的擴充。

如果使用既有專案：

- 評審只評估競賽期間增加的工作。
- 必須清楚區分舊功能與新功能。
- 使用 timestamp、commit history、release 或等效證據證明 WebMCP 擴充時間。

本專案目前只有研究文件，尚無既有應用程式，因此可從競賽期間的第一筆程式 commit 開始保留完整證據。

## 5. 智慧財產、開源與第三方服務

### 5.1 作品所有權

- 作品智慧財產仍屬參賽者、團隊或組織。
- 主辦方取得用於評審的非專屬授權。
- 主辦方與 Devpost 可於競賽期間及其後三年，使用參賽者姓名、肖像、聲音、作品畫面等宣傳競賽及結果。
- Submission 的所有組成必須由參賽者擁有，或已取得合法使用權。

### 5.2 開源依賴

可以使用 open source，但必須：

- 遵守其 license。
- 正確保留 attribution 或 notice。
- 在既有開源專案上做出自己的功能性擴充。
- 不把第三方作品錯誤聲稱為自己的原創成果。

### 5.3 AI 輔助開發

AI coding assistant 可用於 scaffold、debug、測試、文件與 edge-case 思考。參賽者仍須：

- 對提交程式碼、授權與正確性負責。
- 能說明核心架構與 WebMCP 實作。
- 不讓 AI 捏造不存在的功能、使用者測試或效能數據。

### 5.4 第三方 API 與台灣資料

若整合 TDX、中央氣象署、地圖、醫療院所或民間服務資料，必須：

- 遵守 API terms、資料授權與 attribution。
- 將 API key 保留在後端。
- 在前端結果顯示資料來源、更新時間與不確定性。
- 處理 CORS、quota、timeout、上游失效及快取。
- 不把「缺少資料」誤寫為「設施不存在」或「路線安全」。

## 6. 正式評分標準

第一階段是 pass／fail：作品必須符合主題，且合理使用指定技術。

通過後，以下四項等權評分：

1. **WebMCP Leverage**  
   WebMCP 使用是否深入、熟練、可運作、非平凡實作。

2. **Execution**  
   是否為完整、一致、可執行的產品體驗，而不只是技術 proof of concept。

3. **Potential Impact**  
   是否為真實受眾解決具體問題，且 Demo 中的成果足以支持主張。

4. **Creativity & Ambition**  
   概念是否有創意、企圖心，並與既有產品有所區別。

同分時，依上述順序逐項比較，所以 WebMCP Leverage 也是第一個 tie-breaker。

## 7. 「牽手過路走」評分對照

| 評分項目 | 優勢 | 主要風險 | 競賽策略 |
|---|---|---|---|
| WebMCP Leverage | Agent 與使用者共用同一個行程與生活資訊頁面 | 即時語音可能讓 WebMCP 退化成附屬功能 | 主 Demo 必須由 ChatGPT／Codex 發現並呼叫 WebMCP 工具，工具執行後更新同一頁 UI |
| Execution | 可形成完整的無障礙 PWA 體驗 | 目前沒有應用程式與部署 | 只做一條完整且可靠的使用旅程 |
| Potential Impact | 視障者及高齡者是具體、真實的受眾 | 容易做出未驗證的安全宣稱 | 聚焦可信資訊取得，公開不確定性與安全邊界 |
| Creativity & Ambition | 台灣在地資料、語音與人機共頁協作 | 若只是 API 查詢包裝，創新性不足 | 讓 Agent 理解使用者限制、比較方案、修正頁面狀態並生成可聽／可讀結果 |

## 8. 競賽版技術架構

### 8.1 主評審路徑

```text
使用者
  ↕
ChatGPT Work／Codex Agent
  ↓
目前開啟的「牽手過路走」頁面
  ↓ document.modelContext.registerTool(...)
WebMCP Site tools
  ↓
共用 Domain Services
  ↓
TDX／中央氣象署／合法資料來源
  ↓
更新同一頁的可讀、可聽、可修正結果
```

此路徑是競賽評分主體。Demo 必須看得到：

- Agent 發現正確工具。
- Agent 送出結構化參數。
- 工具取得實際或明確標示的 fallback 資料。
- 結果更新人類正在觀看的頁面。
- 使用者可透過鍵盤、螢幕閱讀器或語音檢查及修正。

### 8.2 即時語音路徑

```text
站內即時語音 UI
  ↓ WebRTC
OpenAI Realtime Agent
  ↓ function tools（MVP）／remote MCP（後續）
共用 Domain Services
```

OpenAI Realtime 官方文件提供 function tools 與 remote MCP，但未保證 Realtime Agent 可直接發現並呼叫目前頁面的 WebMCP Site tools。因此：

- 不建立 Realtime 必須穿過 WebMCP 的依賴。
- Realtime 與 WebMCP 共用相同 Domain Services。
- WebMCP 是比賽主路徑。
- Realtime Voice 是人機介面加分項，不能阻塞提交。

這是根據官方文件做出的架構推論，不是競賽禁止事項。

來源：

- [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp)
- [OpenAI Realtime with MCP](https://platform.openai.com/api/docs/guides/realtime-mcp)

## 9. WebMCP 的競賽技術限制

### 9.1 實驗性與瀏覽器限制

- WebMCP 是 proposed／experimental web standard。
- 競賽指定 ChatGPT 桌面版內建瀏覽器或 Chrome 149+ testing flag。
- 一般 Chrome、Safari、Firefox、手機瀏覽器不保證支援。
- 網站必須採 progressive enhancement；WebMCP 不可用時，正常 UI 仍須可操作。

### 9.2 Site tools 與頁面生命週期綁定

- Agent 必須先造訪頁面，才能發現頁面提供的工具。
- 關閉頁面或導向別頁後，工具可能不可用。
- 適合人與 Agent 操作相同頁面及登入狀態。
- 不適合作為背景常駐、排程或跨網站資料服務的唯一入口。

### 9.3 ChatGPT Site tools 可用性

截至核對日，OpenAI 文件指出：

- 使用 GPT-5.6 Sol 或 GPT-5.6 Terra。
- GPT-5.6 Luna 暫停 WebMCP。
- Enterprise、Edu workspace 不支援。
- 實際可用性仍取決於 rollout、最新桌面版與目前頁面提供的工具。

必須同時用 ChatGPT 桌面版與 Chrome testing flag 測試，避免單一環境阻塞。

### 9.4 Origin isolation 與 Permissions Policy

- WebMCP 只在 origin-isolated document 中可用。
- 使用 `document.domain` 或 `Origin-Agent-Cluster: ?0` 退出隔離時，API 會被停用。
- `tools` Permissions Policy 預設允許 top-level 與 same-origin context。
- 跨來源 iframe 若要使用工具，需要正確設定 `allow="tools"`。
- 競賽版優先使用 top-level live URL，不把 iframe 當主要部署方式。

### 9.5 API 選擇

競賽版使用 Imperative API：

```js
if (typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool({
    name: "get_daily_safety_brief",
    description: "Read current official weather and transit advisories for a Taiwan location.",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string" }
      },
      required: ["location"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async ({ location }) => {
      return getDailySafetyBrief(location);
    }
  });
}
```

理由：

- Imperative API 對狀態、錯誤及 UI 更新控制較完整。
- Declarative API 仍有較高的規格變動風險。
- 功能偵測可以讓非 WebMCP 瀏覽器正常降級。

### 9.6 安全與信任

WebMCP 工具名稱、description、輸入與輸出都不能視為天然可信：

- 工具仍須沿用網站既有 authentication、authorization 與 validation。
- 外部文字及資料視為 untrusted content。
- 唯讀工具使用 `readOnlyHint`，但不可把 annotation 當成真正授權控制。
- 重大或不可逆操作需要明確的人類確認。
- 競賽 MVP 不包含付款、代替報案、醫療決定或即時過馬路指令。

來源：

- [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp)
- [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- [WebMCP Specification](https://webmachinelearning.github.io/webmcp/)

## 10. 競賽版 MVP

### 10.1 代表性使用情境

> 「我要從台北車站到台大醫院，請減少步行與轉乘，告訴我下一班車，並檢查是否有大雨。」

Agent 在目前頁面呼叫工具、比較方案、更新同一頁行程；使用者可透過螢幕閱讀器、鍵盤或語音檢查及修正。

### 10.2 第一批工具

#### `plan_accessible_trip`

- 輸入起點、終點、少步行、少轉乘等偏好。
- 回傳候選交通方案，不宣稱絕對無障礙或安全。
- 對未知的電梯、施工、無障礙設施狀態明確標示未知。

#### `get_vehicle_arrivals`

- 查詢指定站牌或路線的預估到站。
- 回傳資料來源、更新時間及 freshness。
- 上游失效時不得捏造到站資訊。

#### `get_weather_safety_brief`

- 查詢雙北目的地未來約 3–6 小時的逐 3 小時天氣與降雨提醒。
- 使用中央氣象署等合法官方資料。
- 把一般提醒與官方警報清楚區分。

### 10.3 頁面完成條件

- Agent 呼叫後，結果同步呈現在目前頁面。
- 語意化 HTML、清楚標題、清單及焦點管理。
- 鍵盤可完成全部操作。
- 支援高對比、大字體與 reduced motion。
- `aria-live` 只播報必要變化，避免與語音助理重複朗讀。
- 提供「重複」「只說下一步」「改成少轉乘」「停止」等控制。
- WebMCP 不支援時保留完整的人類 UI。
- 明示產品是資訊輔助，不是白手杖、導盲犬、定向行動訓練或道路安全判斷的替代品。

## 11. Demo 策略

三分鐘影片建議結構：

1. **0:00–0:20：問題與受眾**  
   說明台灣視障者／高齡者在查詢交通、到站與天氣時需要切換多個服務。

2. **0:20–1:40：完整 WebMCP 操作**  
   在 ChatGPT 內建瀏覽器開啟網站，提出代表性需求，顯示 Agent 發現並呼叫三個工具，頁面同步更新。

3. **1:40–2:15：無障礙體驗**  
   示範鍵盤、螢幕閱讀器可讀結果、重複下一步或修改偏好。

4. **2:15–2:40：即時語音加分項**  
   若已穩定，快速示範站內語音詢問；若不穩定則省略。

5. **2:40–2:55：技術與安全邊界**  
   顯示 WebMCP、TDX／氣象資料、progressive enhancement 及非安全關鍵定位。

6. **2:55 前結束**  
   不壓到三分鐘硬限制。

影片與 README 應確保即使評審不實際操作 live app，也能判斷 WebMCP 確實運作。

## 12. 七天交付計畫

### 2026-08-27

- 註冊 Devpost。
- 建立公開 repository、README、LICENSE 與 `.env.example`。
- 建立可部署的最小 Web app。
- 建立 Devpost draft。

### 2026-08-28

- 完成無障礙主頁與 mock fixtures。
- 註冊三個 WebMCP tools。
- 建立 UI 與 tool execute 共用的 Domain Services。

### 2026-08-29

- 整合 TDX／中央氣象署 adapter。
- 加入 server-side secrets、cache、timeout 與 fallback。

### 2026-08-30

- 在 ChatGPT 桌面版及 Chrome testing flag 測試。
- 修正 tool schema、description、錯誤與頁面狀態同步。

### 2026-08-31

- 執行鍵盤、NVDA／VoiceOver、對比及 zoom 測試。
- 執行 WebMCP deterministic tests 與模型 prompts eval。
- 若能取得真實使用者或無障礙專業者協助，進行小型可用性測試；不可捏造測試結果。

### 2026-09-01

- 核心功能穩定後，再加入最小 Realtime Voice。
- Realtime 若造成不穩定，立即從競賽主路徑移除。

### 2026-09-02

- 功能凍結。
- 完成部署、英文 README、測試指引、專案描述及 license 核對。

### 2026-09-03

- 錄製及上傳少於三分鐘的 Demo。
- 在兩種目標瀏覽器做最後 smoke test。
- 台灣時間 20:00 前完成 Devpost 提交。

## 13. 可行性評估

| 面向 | 評估 | 說明 |
|---|---|---|
| 台灣參賽資格 | 高 | 台灣是 OpenAI API 支援地區，仍須滿足成年與無利益衝突等個人條件 |
| 最低合規 submission | 中高 | 技術範圍不大，但 live app、public repo、license、英文材料與影片缺一不可 |
| 三工具 WebMCP MVP | 高 | Imperative API 可直接實作；真正風險在資料整合、部署與測試 |
| 無障礙完整體驗 | 中高 | 可先完成鍵盤、語意 HTML、螢幕閱讀器與清晰內容層級 |
| OpenAI Realtime Voice | 中 | 需要 WebRTC、權限、短效憑證、工具調用、成本與裝置測試 |
| 全台完整服務 | 低 | 七天內不應承諾全台資料完整度與正式營運可靠性 |
| 即時過馬路判斷 | 不採用 | 屬安全關鍵能力，資料與感測條件不足，不應納入競賽 MVP |
| 得獎競爭力 | 中等、有上升空間 | 題目與 Impact 強；能否競爭前十取決於 WebMCP 深度、Demo 清晰度與完成度 |

## 14. Go／No-Go Gate

### Go

符合以下條件就繼續參賽：

- 2026-08-28 前完成 WebMCP 工具註冊與 mock end-to-end。
- 2026-08-30 前至少在 Chrome testing flag 成功呼叫工具。
- 2026-09-01 前有穩定 live URL。
- 三個唯讀工具能可靠執行並更新同一頁 UI。
- 非 WebMCP 瀏覽器仍可操作網站。

### Cut Scope

發生下列情況時不退賽，但刪減功能：

- TDX 或氣象 API 不穩：使用清楚標示的 snapshot／fixture，保留一個真實資料整合。
- Realtime Voice 不穩：移出主 Demo，只保留鍵盤與螢幕閱讀器體驗。
- 行程規劃過於複雜：限縮台北市、固定示範路線或以交通選項比較取代完整導航。
- ChatGPT rollout 無法測試：使用 Chrome 149 testing flag、Inspector 與錄製證據完成驗證。

### No-Go

只有以下情況才停止本次提交：

- 截止前沒有可供評審存取的 live URL。
- 無法提供公開 repository 與合法 open-source license。
- WebMCP 工具實際不能被目標瀏覽器發現或呼叫。
- 無法合法使用關鍵第三方程式碼或資料。

## 15. 規則矛盾與保守處理

### 15.1 Demo 影片

Resources FAQ 有一句疑似誤植，暗示沒有影片；但同一頁其他段落及正式規則都明確要求少於三分鐘的公開 YouTube Demo。

處理：**依正式規則，影片為必交。**

### 15.2 多件 submission

正式規則的 Multiple Submissions 段落第一句明訂 Entrant 不得提交超過一件，後半句卻出現制式的「其他 submissions 必須明顯不同」文字。

處理：**只提交一件「牽手過路走」。若要以不同團隊身分另交作品，先取得 Devpost 書面澄清。**

### 15.3 截止後修改

正式規則禁止截止後修改 submission；FAQ 更警告不要修改 submitted repo 或 live site，直到公布結果。

處理：

- 截止前建立 release tag。
- 凍結 repository 的 default branch 與 live deployment。
- 若要繼續開發，建立不影響提交版本的 fork 或獨立 branch／deployment。
- 不以修正名義實質改變評審版本。

## 16. 提交前檢查清單

### 資格與行政

- [ ] 已在 Devpost 完成註冊。
- [ ] 參賽者符合成年、地區與利益衝突規則。
- [ ] 團隊／組織已指定 Representative。
- [ ] 只提交一件作品。

### 應用程式

- [ ] Live URL 可從全新瀏覽器工作階段開啟。
- [ ] ChatGPT 內建瀏覽器或 Chrome 149 testing flag 能發現工具。
- [ ] WebMCP execute 結果與影片一致。
- [ ] 非 WebMCP UI 完整可用。
- [ ] 評審所需登入憑證及測試說明有效。

### 程式碼與授權

- [ ] Repository 公開。
- [ ] 包含可辨識的 `LICENSE`。
- [ ] README 有安裝、環境變數、測試與部署步驟。
- [ ] WebMCP 註冊存在於真正運作的 source code。
- [ ] 無 API key、token、個資或其他 secrets。
- [ ] 第三方程式碼、資料與素材皆符合授權。
- [ ] Git history 可證明競賽期間新增的 WebMCP 工作。

### 無障礙與安全

- [ ] 全鍵盤可操作。
- [ ] 螢幕閱讀器能理解結果及狀態變化。
- [ ] 不依賴顏色傳達唯一資訊。
- [ ] 高風險資訊包含來源、更新時間及不確定性。
- [ ] 未宣稱可以判定是否安全過馬路。

### 提交材料

- [ ] 英文專案介紹完整回答四個必答問題。
- [ ] Demo 少於三分鐘、公開、含聲音。
- [ ] 中文旁白或內容附完整英文字幕／翻譯。
- [ ] 影片清楚顯示 Agent 實際呼叫 WebMCP。
- [ ] 沒有未授權音樂、商標或素材。
- [ ] Devpost 表單所有 URL 已從未登入狀態驗證。

## 17. 正式來源

### 競賽

- [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Devpost Overview](https://webmcp.devpost.com/)
- [Devpost Official Rules](https://webmcp.devpost.com/rules)
- [Devpost Resources and FAQ](https://webmcp.devpost.com/resources)
- [Devpost Schedule](https://webmcp.devpost.com/details/dates)

### OpenAI

- [Supported countries and territories](https://platform.openai.com/docs/supported-countries)
- [Site tools](https://learn.chatgpt.com/docs/webmcp)
- [Realtime with MCP](https://platform.openai.com/api/docs/guides/realtime-mcp)

### WebMCP 與 Chrome

- [WebMCP Specification](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp)

## 18. 搜尋摘要

- OpenAI 官方：WebMCP Challenge、Site tools、API 支援地區；3 個頁面，5 次擷取核對。
- Devpost：Overview、Official Rules、Resources／FAQ、Schedule；4 個頁面，5 次擷取核對。
- Chrome Developers：WebMCP 支援、限制、origin isolation、permissions；1 個頁面。
- 搜尋方式：先檢查 OpenCLI 搜尋來源，再依指定網址透過 Jina MCP 直接讀取正式頁面。
- 未使用第三方新聞或評論，因為正式規則與官方技術文件是本題的權威來源；搜尋期間未遇到 rate limit。

## 19. 維護規則

在提交前至少再次核對：

1. Devpost deadline、submission form 與 Official Rules 是否更新。
2. ChatGPT Site tools 支援模型、workspace 與 rollout。
3. Chrome 最低版本、flag、Origin Trial 與 WebMCP API 形狀。
4. Live URL、評審帳號、公開 repository 與 YouTube 影片權限。
5. TDX、中央氣象署及其他資料來源的 terms、quota 與 attribution。
6. 所有規則疑義以書面詢問 Devpost／hackathon manager，並保存回覆。
