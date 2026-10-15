# 公開網站設定與首次登入

狀態：部署來源已備妥，尚未建立 Render 資源、尚未扣款、尚未取得公開網址。不能把本機 127.0.0.1 分享給其他網路的玩家。

**目前約束：初期預算為 0。以下免費公開測試方案取代先前的付費常駐規格；不得建立付費資源或自動升級。**

使用 Render Free Web Service + Neon Free PostgreSQL。前端沿用平台提供的子網域與 HTTPS，不購買網域；暫不部署 Redis，單一 API 使用已實測的 PostgreSQL 房間及 Socket.IO 路徑。帳號與聊天資料保存在獨立資料庫，不放 Render 本機檔案系統。多人語音及遊戲仍按原先階段開發。

免費方案限制：Render 15 分鐘無入站流量會休眠，再次開啟可能等待約 1 分鐘，可能重啟，且有每月用量上限。Neon Free 現行方案不需信用卡、沒有固定試用期限，但有運算／儲存配額，不能承諾永久不變或無限容量。額度不足時停止測試並處理資料備份，不自動改成付費。Render 免費 Postgres 30 天到期，因此不拿它保存需要持續保留的玩家資料。

## 使用者目前只需完成

1. Render 帳號已註冊。先保持目前 Dashboard，不選 Upgrade，也不新增付款方式。
2. 開啟 https://console.neon.tech/signup ，註冊 Neon，選 **Free**，建立 PostgreSQL 專案；如畫面要求付費、信用卡或升級就停下確認。不要把密碼、驗證碼或資料庫連線字串貼到聊天。
3. 使用已建立的公開 GitHub 儲存庫 qa07041018-jpg/party-island，完成原始碼寫入授權，再建立 Render **Free Web Service**。只選 Free；若免費資格不成立或平台要求付費則不繼續建立。

Render Blueprint 需要可連接的 Git 儲存庫。使用者已選擇公開原始碼；發布版本必須排除 .env、本機帳密、連線字串、執行資料及快取，僅保留不含真實憑證的 .env.example。

## 已準備的部署內容

- `render.yaml`：僅一個 Render Free Node 服務，位置為 Singapore；DATABASE_URL 於建立時填入 Neon Free 的 TLS 連線字串，不由 Blueprint 建立任何付費資料庫或 Redis。
- 玩家首頁 `/`、管理端 `/admin/`、REST API 與 Socket.IO 使用同一 HTTPS 網址。
- `pnpm cloud:build`：編譯 Nest、輸出 Next 管理端為靜態頁、清除 Metro 快取後輸出 Expo Web；公開瀏覽器 API 位址設為同源，沒有 localhost API。
- `SERVE_WEB=1`：由 Nest 提供兩個前端。管理端靜態頁可公開讀取，但管理資料與操作仍經伺服器 admin 授權。
- `cloud-start`：先執行 migration，再以交易及 advisory lock 建立第一個 admin；已有 admin 時保留，不會覆寫密碼或提升既有玩家權限。
- Neon PostgreSQL 以平台提供的 TLS 連線字串驗證連線，不關閉憑證驗證；連線字串僅存 Render Environment。JWT 祕密不進原始碼，首次建立在 Dashboard 填寫至少 48 字元亂數。管理員 email 在 Dashboard 填寫；密碼由平台隨機產生。
- CSP 以建置後 HTML 的 inline script SHA-256 白名單授權 Next 啟動腳本，不需開放任意 inline JavaScript。

Blueprint 已改為 Free；沒有任何付費規格或平台資料庫宣告。尚未執行建立或付款動作。此階段為免費公開測試，需接受休眠及配額，不能宣稱達到 24 小時不中斷的正式營運目標。網站在雲端執行，不需要這台電腦開機。

## 第一次如何登入

### 一般玩家

部署成功後開啟實際回傳的公開網址，按「建立帳號」，填入自己的信箱、暱稱和至少 10 碼密碼；以後在同一網址按「登入」。公開版與本機開發資料庫不同，本機測試帳號不會自動搬過去。

### 你自己的管理員

開啟「實際公開網址 + `/admin/`」。帳號是部署設定的 `ADMIN_EMAIL`；初始密碼是 Render Environment 中自動產生的 `ADMIN_PASSWORD`。部署成功後私下保存到密碼管理器，不要貼到聊天。首次建立成功後可移除 Environment 中的 ADMIN_PASSWORD；既有管理員密碼已雜湊存入資料庫，重啟不會重設。此版本尚無管理員改密碼 UI。

原本本機 `owner@party-island.local` 和 `.env.admin.local` 只用於開發，不上傳、不沿用到公開站。

## 部署後才可列為完成

1. Build 與啟動成功、/health 成功，得到平台實際發出的 HTTPS 網址。
2. 在該網址註冊兩個不同帳號，建立房間，兩方傳送訊息並重新整理。
3. 使用手機行動網路和另一個網路測試 Socket.IO，檢查重連。
4. 驗證 admin 登入、一般玩家被拒絕、公告可顯示。
5. 重啟服務，確認 Neon 資料持久化，實際匯出備份並驗證還原；本方案不啟用 Redis。
6. 解決或評估既有依賴公告，確認代理下限流、保留政策和公開測試範圍。

目前只完成本機部署形態驗證；上述公網、Render Free、Neon Free 驗收仍待帳號連接與實際部署。

官方參考：https://render.com/docs/blueprint-spec 、 https://render.com/docs/websocket 、 https://render.com/docs/free 、 https://neon.com/pricing 。
