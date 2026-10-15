# 第一階段驗證紀錄

日期：2026-10-15 至 2026-10-16（Asia/Taipei）。此紀錄描述本機實際驗證，不等同正式上線驗收。

## 環境

- Windows，Node.js 24.19.0，pnpm 11.25.0。
- PostgreSQL 17.11 官方 Windows binaries，僅綁 127.0.0.1:55432，scram-sha-256 驗證。
- 開發 DB `island`、獨立整合測試 DB `island_test`。祕密由本機隨機生成，未寫死於程式碼。
- 未安裝 Docker／Redis，未配置 LiveKit／S3／雲端主機。Redis adapter 只完成程式接入，未實測。
- PostgreSQL 在中文路徑初始化時發生 UTF-8 編碼錯誤；以 `subst P:` 指向工作目錄的 ASCII 路徑成功修正。`scripts/local-db.ps1` 會驗證既有映射，不覆蓋其他磁碟。

## 建置與自動測試

| 指令 | 實際結果 |
|---|---|
| pnpm build | NestJS TypeScript 及 Next.js production build 通過 |
| pnpm typecheck | API、mobile、admin 全部通過 |
| pnpm test | 2 項單元測試通過，0 失敗 |
| pnpm test:integration | 10 個子情境 + 1 個父測試，11 pass、0 fail；真實 PostgreSQL、HTTP 和 Socket.IO |
| pnpm --filter @island/mobile export:web | Expo Metro Web 輸出成功（3 張原創圖片，JS 約 588 KB） |
| pnpm peers check | 無 peer dependency 問題 |
| scripts/local-db.ps1 status | 正確辨識本機 PostgreSQL 程序 |

### 整合測試子情境

1. 註冊／登入／訪客／不同 UID、拒絕重複信箱、錯誤密碼及非法輸入；未登入與一般玩家不可讀管理 API。
2. 修改暱稱及頭像色後讀取 PostgreSQL 資料；伺服器錢包初始 0。
3. 私人房間不出現在其他玩家列表；密碼錯誤拒絕；非會員不能讀快照。
4. 兩人競爭最後一席，僅一人加入；容量與唯一座位成立；不可同時建立第二間房。
5. 兩個帳號的 Socket.IO 即時同步聊天；斷線重連恢復會員資格；第三人不能闖入傳訊息。
6. 非房主踢人被拒絕；房主離房移轉；最後一人離房，關房狀態持久化。
7. 房主移除玩家後，該玩家無法再次加入同一房間。
8. Refresh Token 輪替後，舊 token 重播觸發整個 family 撤銷，新 token 也失效。
9. 管理員授權、停權與稽核；停權後既有 Access Token 不能使用。
10. 關閉／重新建立 Nest 服務，玩家資料及房間仍可讀取。

## 瀏覽器流程

用本機開發資料庫實際完成：註冊新帳號 → 載入大廳 → 建立 6 人公開文字房 → 送出訊息 → 重新整理 → 恢復同一房間及訊息 → 離房 → 返回大廳。開發帳號及房間均為實際測試產生，沒有填入假在線玩家。

390px viewport 的 DOM 檢查：`viewport=390, page=390`，沒有文件橫向溢出。該尺寸截圖工具未成功輸出檔案，因此不提供不存在的手機截圖。已保存預設瀏覽器尺寸的 `artifacts/room-verified.png` 與 `artifacts/lobby-verified.png`；Web 圖片修正後確認 background-size 為 cover。此結果不替代 Android／iPhone 真機測試。

本機管理員建立指令已執行；隨機密碼保留於忽略檔 `.env.admin.local`。使用該帳號實際登入回傳 201、角色為 admin，管理 overview 回傳 200。後台已完成 production build，但停權／公告 UI 尚未逐項人工點擊驗收；相關 API 經整合測試。

## 依賴稽核未通過

`pnpm audit --prod` 回報 3 項公告（2 high、1 moderate），原始 JSON 保存在 `artifacts/dependency-audit.json`。依賴路徑來自 Expo CLI／Metro 工具鏈；不能把建置成功解讀為沒有資安問題。

- node-forge：high；[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)，稽核回應沒有修補版本。
- braces：high；[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，稽核回應沒有修補版本。
- uuid：moderate；[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)，修補版本 >=11.1.1；Expo 間接使用較舊版本。尚未強制跨主版覆寫，避免破壞工具鏈，需升級相容 Expo 套件後再次驗證。

Dockerfile 的安裝範圍已限制於 API 和 admin，避免把手機 Expo 工具鏈納入伺服器依賴；因本機無 Docker，尚未驗證實際映像內容或容器稽核。

## 尚未完成／不可宣稱通過

- 誰是臥底、你畫我猜、狼人殺、太空推理與搶唱引擎。
- 麥克風、LiveKit／TURN、語音禁言、背景音訊與真機跨網路通話。
- Android APK／iPhone IPA、推播、簽章與商店發佈。
- 公網 HTTPS/WSS 常駐雲端部署、Redis 多節點、Docker build／啟動、真機不同網路測試。
- 好友、私訊、群組、動態、圖片上傳、檢舉審核、申訴、資料匯出／刪除、完整 RBAC 與營運監控。
- 每日獎勵、商城、禮物與交易操作；本階段僅建立零餘額錢包及 ledger 結構，沒有真實付款。
- 壓力測試、備份還原、可用性與正式安全審查。

下一階段依計畫實作伺服器版誰是臥底，先完成狀態機與多人整局測試，再開啟遊戲入口。

## 2026-10-16 公開部署準備追加驗證

新增同源玩家與 /admin/ 靜態管理端、Render Blueprint、首次 admin bootstrap 與 CSP hash 白名單。pnpm cloud:build 成功，pnpm typecheck 通過，既有單元測試 2 項通過；整合測試新增 admin 初始化情境，目前為 11 個子情境 + 父測試共 12 pass、0 fail。新情境在獨立測試 schema 驗證重複啟動不改密碼、無法把同 email 玩家升權、首次建立有稽核。

本機同源 / 與 /admin/ 均為 HTTP 200，管理頁 6 支 JS 均為 200，inline script CSP hash 缺少數為 0；玩家公開版 bundle 已檢查沒有 localhost API 位址。公開站尚未建立，Render/Redis/公網實測仍待使用者帳號連接。原始第一階段紀錄與封存包保持歷史結果。

## 2026-10-16 零預算設定調整

使用者指定初期完全無預算。render.yaml 改為僅 1 個 plan: free Web Service；移除付費 Postgres 與 Redis，改為建立時填入 Neon Free DATABASE_URL，REDIS_URL 空白。已檢查 YAML 格式與配置中無付費規格／資料庫／Redis 宣告；未建立雲端資源、未扣款。後端程式未變動，不重複執行同一套測試。本方案公網與 Neon 連線仍待部署實測；不可宣稱 24/7 不休眠或無限免費。
