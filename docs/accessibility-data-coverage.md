# 無障礙資料覆蓋報告

> 結論：目前資料足以讓系統「降低已標記障礙的優先度」，但不足以證明任何一條行程全程無階梯、適合輪椅或適合視障者。產品只能在同一批候選都有可比較分數時說「依目前已標記資料，相對較適合」；其他情況一律說「未知」。
>
> 稽核日期：2026-09-01（Asia/Taipei）
>
> 稽核前基準提交：`8704785`；判準實作以本文件所在提交為準
>
> 範圍：目前雙北 OTP graph 使用的 TDX GTFS、臺北捷運 GTFS、裁切後 OpenStreetMap 與 OTP 2.9 設定

## 1. 可重現方式

在更新 GTFS、OpenStreetMap、OTP graph 或 routing config 後執行：

```powershell
& .\infra\otp\audit-accessibility-coverage.ps1
```

腳本會輸出 JSON，包含資料檔雜湊、時間、GTFS 欄位覆蓋率、站內路徑檔案是否存在，以及 OTP 是否允許未知資料。報告不把缺值解讀為可通行，也不以 OTP 成功產生路線代表無障礙資料完整。

## 2. 目前資料快照

| 資料層 | 已知資料 | 未知／缺漏 | 可支持的結論 |
|---|---:|---:|---|
| 雙北公車站點 | `wheelchair_boarding` 0／61,739（0%） | 61,739（100%） | 所有公車站點上下車條件皆未知 |
| 雙北公車班次 | `wheelchair_accessible` 0／79,358（0%） | 79,358（100%） | 所有公車班次車輛條件皆未知 |
| 臺北捷運站點／月臺節點 | `wheelchair_boarding=1` 523／722（72.4%） | 199／722（27.6%） | 只能確認特定 GTFS 節點有輪椅上下車標記，不能推論完整進出站動線 |
| 臺北捷運班次 | `wheelchair_accessible=1` 5,520／5,520（100%） | 0 | 可描述 GTFS 對班次的輪椅標記；不能推論電梯即時可用 |
| GTFS 站內路徑 | 兩份 feed 均無 `pathways.txt`、`levels.txt` | 全部車站內入口、電梯、樓層與月臺連通關係未知 | 不能證明入口到月臺或轉乘過程無階梯 |
| OpenStreetMap 街道 | OTP 可使用已標記的階梯、坡度與不便通行資訊 | 現行管線未統計逐路段 `wheelchair`、`steps`、`kerb`、`incline`、`surface`、`smoothness`、`tactile_paving`、`audible_signals` 覆蓋率 | 只能降低已標記障礙的優先度；所有缺值皆未知 |
| 即時營運狀態 | TDX 到站與臺北捷運進站資料 | 未整合電梯故障、施工、臨時改道、低地板車輛即時狀態 | 不能把靜態標記當成本次出發時仍可用 |

資料檔指紋：

- 雙北公車 GTFS：`6cd1b942032c45d646ccff4d79337537b7213592eae7f15267e517582cc07deb`
- 臺北捷運 GTFS：`895c55f1e05257541c61d10549773a5cb6bad32d7764dcfbdc48d21188c9758e`
- 雙北 OSM PBF：`9b5e54ade69ea7e6ec804840405828625f79512b129beb733f9087178906d3b7`

### 重要解讀

1. GTFS 的 `0` 或空值代表「沒有資料」，不是「不可通行」，也不是「可通行」。
2. OTP 設定允許未知站點、班次與電梯進入候選路線，並以成本降低其優先度；這是為了避免完全沒有結果，不是無障礙驗證。
3. OTP 的 `accessibilityScore` 是 0–1 的比較資訊，且必須另外啟用。它只能用來比較同一批候選，不能轉譯成安全率、成功率或全程無障礙程度。
4. 輪椅標記不能代表視障者需求。觸覺鋪面、音響號誌、連續人行道、障礙物與施工沒有足夠覆蓋時，不得說「適合視障者」。

## 3. 對外用語規則

### A. 可以說「相對較適合」

必須同時符合：

1. 同一次查詢至少有 2 個候選方案。
2. 每個候選都有有效的 OTP `accessibilityScore`。
3. 被選方案的分數是最高，且至少嚴格高於另一個候選。
4. 句子必須限定資料與比較範圍，不得省略「依目前已標記資料」與「相對」。

允許用語：

> 依目前已標記資料，這個方案相對較適合。

並且必須緊接：

> 這只表示它在本批候選中的無障礙資料評分較高；未標記的階梯、坡度、電梯狀態與施工仍屬未知。

### B. 必須說「未知」

出現任一條件即屬未知：

- 只有 1 個候選。
- 任一候選的 `accessibilityScore` 缺失、超出 0–1 或無法比較。
- 公車路段缺少站點或班次輪椅欄位。
- 車站缺少完整 `pathways.txt`／`levels.txt`。
- 步行路段缺少階梯、坡度、路緣、路面或人行道連續性資料。
- 需要電梯，但沒有本次出發時的營運狀態。
- 要回答是否適合視障者，但缺少觸覺鋪面、音響號誌與連續人行環境資料。

標準用語：

> 無障礙資料不足，這趟路仍屬未知。

補充說明：

> 規劃時已降低有階梯或不便通行標記路段的優先度，但未知路段仍可能被採用，不能視為無階梯路線。

### C. 已知有障礙

若資料明確標示 `wheelchair=no`、`wheelchair_accessible=2`、只能走樓梯，或即時資訊顯示必要電梯停用：

- 不得使用「較適合」。
- 必須指出障礙位於哪一段。
- 若仍顯示該方案，必須說明是因目前沒有資料更完整的替代方案，並把它標成需注意，而不是建議無障礙路線。

目前 GraphQL 映射尚未把逐段障礙原因帶到 UI，因此這一級仍是資料整合缺口，不能假裝已完成。

### D. 永遠禁止的說法

- 「無障礙路線」
- 「全程無階梯」
- 「保證可通行」
- 「適合視障者」
- 「已避開所有階梯」
- 把 `accessibilityScore` 顯示成百分比或成功率

## 4. 系統實作對照

| 系統行為 | 規則 |
|---|---|
| 規劃請求 | 可以啟用 wheelchair preference，降低已知階梯、已知不便與未知資料的優先度 |
| 候選比較 | 只有所有候選皆有分數且被選方案嚴格較高，才顯示「相對較適合」 |
| 其他結果 | 統一顯示「無障礙資料不足，這趟路仍屬未知」 |
| 朗讀 | 必須朗讀未知限制，不得只朗讀路線步驟 |
| WebMCP | 回傳相同結論；Agent 不得把「相對」改述為「無障礙」或「安全」 |

## 5. 補資料優先順序

1. 保留並稽核營運單位可取得的公車站點、低地板車輛與班次無障礙欄位；若來源沒有，維持 0% 而不是自行推定。
2. 取得捷運入口、電梯、樓層、月臺連通與電梯即時故障資料，轉為可追溯的站內路徑證據。
3. 在 OSM 裁切／建圖流程加入逐路段標記覆蓋統計，至少涵蓋階梯、坡度、路緣、表面、平整度與輪椅標記。
4. 視障需求另建證據層：觸覺鋪面、音響號誌、人行道連續性、施工與現場障礙，不與 wheelchair score 混為一談。
5. 讓已知障礙原因進入 OTP GraphQL 映射、可見 UI、朗讀與 WebMCP 結果。
6. 每次資料更新或 graph 重建後自動執行覆蓋稽核；覆蓋率下降時阻止發布或改為明確警告。

## 6. 判準依據

- [GTFS Schedule Reference](https://gtfs.org/documentation/schedule/reference/)：`wheelchair_boarding`、`wheelchair_accessible`、`pathways.txt`、`levels.txt` 的正式定義。
- [GTFS Pathways and physical accessibility](https://gtfs.org/documentation/schedule/examples/pathways/)：站點、班次與站內實體路徑的無障礙描述方法。
- [OpenTripPlanner Accessibility](https://docs.opentripplanner.org/en/latest/Accessibility/)：未知資料成本與 `onlyConsiderAccessible=false` 的限制。
- [OpenTripPlanner IBI Accessibility Score](https://docs.opentripplanner.org/en/latest/sandbox/IBIAccessibilityScore/)：0–1 分數與啟用方式；此功能仍位於 sandbox 文件區。
- [OpenStreetMap `wheelchair=*`](https://wiki.openstreetmap.org/wiki/Key:wheelchair) 與 [`kerb=*`](https://wiki.openstreetmap.org/wiki/Key:kerb)：明確標記與缺值不可互相推定。

## 7. 發布門檻

在下列條件未同時成立前，產品定位維持「提供有來源限制的行前資訊」，不得改稱「無障礙導航」：

- 逐段障礙原因能從資料層傳到 UI、朗讀與 Agent。
- 使用的站點、班次、站內路徑及步行路段覆蓋率有可追溯報告。
- 電梯等會變動的必要設施具有當次出發可用狀態，或明確顯示未知。
- 3–5 位目標使用者理解「相對較適合」不等於無障礙保證，且沒有因此產生 P0 誤解。
