# 玩伴島 Party Island — 第一階段

公開部署準備與首次登入方式見 [公開網站設定](docs/PUBLIC_DEPLOYMENT.md)。目前尚未取得正式雲端網址。

這是新的 Expo + NestJS + Next.js 平台，與先前 `party-island` 靜態 Sites 原型分開。已實作範圍：帳號、真實大廳、文字房間、即時聊天及基本系統管理。遊戲與語音尚未實作。

## 本機啟動

需要 Node.js 24、pnpm 11.25、PostgreSQL 17（或 Docker）。本次開發機已另外啟動真實 PostgreSQL，使用 127.0.0.1:55432；本機生成的 `.env` 僅用於開發，不要上傳。

在此專案根目錄執行：

```powershell
# 僅這台已準備好的開發機，重開機後先啟動本機 DB：
./scripts/local-db.ps1 start
pnpm install --frozen-lockfile
# 首次設定：複製 .env.example 為 .env 並填入自己的 DB 與隨機 JWT_SECRET。
# 已有 .env 時不要覆蓋。
pnpm --filter @island/api build
pnpm db:migrate
pnpm dev:api
```

另外開兩個終端：

```powershell
# 手機端（開發介面）
pnpm --filter @island/mobile web
# 管理端
pnpm dev:admin
```

手機端在 `http://localhost:8081`，管理後台 `http://localhost:3000`，API 健康檢查 `http://localhost:4000/health`。`dev:api` 監看編譯後 JS；修改後端 TS 後執行 `pnpm --filter @island/api build`，或另開 `pnpm --filter @island/api exec tsc --watch`。

手機環境變數請放 `apps/mobile/.env.local`，只有 `EXPO_PUBLIC_API_URL=http://電腦區網IP:4000`；管理端放 `apps/admin/.env.local`，只有 `NEXT_PUBLIC_API_URL=http://localhost:4000`。在真手機上不可用 localhost 指向電腦。瀏覽器來源要加進根 `.env` 的 `CORS_ORIGINS` 並重啟 API。正式環境使用 HTTPS，重建前端以套用 URL。

Expo Go 是否支援此 SDK 取決於安裝版本；原生驗收應建立 development build。`eas.json` 已包含 Android APK preview 設定，但本次沒有執行付費雲端建置或簽章。

## 雙帳號測試

1. 用兩個瀏覽器或一般／無痕分頁，分別註冊 A、B（密碼至少 10 碼）。每個分頁有獨立 refresh token。
2. A 建立公開或私人文字房間。私人房間複製完整邀請碼給 B。
3. B 點公開房間或輸入邀請碼；若有密碼需填入。兩邊座位及聊天應同步。
4. B 重新整理後自動恢復帳號／房間；暫時斷線不釋放座位。
5. A 離房後房主自動交給 B；最後一人離房後房間關閉。
6. 餘額初始為 0，沒有假在線玩家、假房間或假好友。

手機 Refresh Token 使用 Expo SecureStore；Web 驗證頁用分頁 sessionStorage，關閉分頁可能清除登入狀態，但伺服器帳號資料仍存在。正式 Web 驗證應另增 HttpOnly Cookie/BFF。訪客沒有密碼，登出後無法找回，僅供短期體驗。

## 管理員

沒有預設管理員或寫死的帳密。自行指定環境變數後執行一次：

這台開發機已建立 `owner@party-island.local` 管理員，隨機密碼僅存本機 `.env.admin.local`，已排除版本控制及原始碼封裝。它是開發帳號，不能沿用到正式環境。

```powershell
$env:ADMIN_EMAIL='你自己的管理員信箱'
$env:ADMIN_PASSWORD='自行產生至少10碼的獨特密碼'
pnpm admin:create
Remove-Item Env:ADMIN_PASSWORD
Remove-Item Env:ADMIN_EMAIL
```

管理員可看最近 100 位玩家／100 間房／100 筆稽核、停權／恢復玩家及發公告。未開放金幣調整、道具、活動、檢舉審核或細分管理員角色操作。已存在的 email 不會被自動升權；管理員建立指令拒絕重複 email。

## 自動驗證

```powershell
pnpm build
pnpm typecheck
pnpm test
# 必須另外建立名稱以 _test 結尾的資料庫，絕不可指向正式 DB：
# .env 新增 TEST_DATABASE_URL=postgresql://.../island_test
pnpm test:integration
pnpm --filter @island/mobile export:web
```

整合測試會啟動真實 Nest HTTP 與 Socket.IO，用 PostgreSQL 存資料，建立專用測試帳號；不清空資料庫。請定期刪除測試資料庫並重建，以免測試帳號累積。測試程序也會重啟 API 驗證持久化。

## Docker／雲端

```powershell
docker compose up --build -d
docker compose logs -f api
```

根 `.env` 的 POSTGRES_* 與 JWT_SECRET 必須先設定。密碼採 URL-safe 隨機字串，或在 DATABASE_URL 中正確 percent-encode。Compose 不向外開 Redis；PostgreSQL／API／admin 綁定 localhost，雲端需另配 HTTPS reverse proxy 與 WebSocket 升級支援。設定公開 `NEXT_PUBLIC_API_URL` 作為 admin 建置參數，手機也需使用公開 HTTPS API。

Compose 先等待 PostgreSQL 健康、執行 migration，再啟動 API 和 admin，資料存於 volume。不要使用 `docker compose down -v`，除非確定要刪除資料。備份以 PostgreSQL pg_dump 與還原演練為準。

**本機沒有 Docker，因此此部署設定尚未實際建置驗證；本次沒有雲端主機、真機語音、APK 或 IPA 驗收。** 單台 PostgreSQL 開發驗證不等於正式容量或可用性保證。

更多架構、房間斷線政策與後續順序見 [開發計畫](docs/DEVELOPMENT_PLAN.md)，實際測試結果見 [驗證紀錄](docs/VERIFICATION.md)。
