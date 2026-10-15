# 第一階段 API

REST JSON，預設 API port 4000；以 `Authorization: Bearer <accessToken>` 驗證。錯誤回傳 HTTP 400（輸入）、401（帳號／token）、403（權限）、404（不存在）、409（衝突／已滿）、429（限流）、500／503（服務異常）。不得顯示為操作成功。

| 方法／路徑 | 驗證 | 內容 |
|---|---|---|
| POST /auth/register | 無 | email、password（10–128）、nickname（2–24）；回傳 user、accessToken、refreshToken |
| POST /auth/login | 無 | email、password |
| POST /auth/guest | 無 | nickname |
| POST /auth/refresh | refresh token | refreshToken；每次輪替，客戶端需立刻保存新 token |
| POST /auth/logout | refresh token | refreshToken；撤銷此 token family，既有 Access Token 最多仍有效 15 分鐘 |
| GET /me | 玩家 | UID、nickname、avatar_color、role、status、experience、is_guest |
| PATCH /me | 玩家 | nickname、avatarColor（#RRGGBB） |
| GET /lobby | 玩家 | 真實 player／wallet／rooms／announcements／currentRoom／online／games |
| GET /rooms | 玩家 | 公開及自己所在私人房間，最多 100 |
| GET /rooms/current | 玩家 | 自己所在房間或 null |
| GET /rooms/:id | 房間成員 | 成員及最近 50 則聊天快照 |
| POST /rooms | 玩家 | name、visibility（public/private）、capacity（2–12）、game（僅 social）、可選 password（4–64） |
| POST /rooms/:id/join | 玩家 | 可選 password；不在其他房間且仍有空位 |
| POST /rooms/:id/leave | 玩家 | 空物件；離房並移轉房主或關房 |
| POST /rooms/:id/kick | 房主 | userId；移除且封鎖該玩家重入此房 |
| GET /admin/overview | admin | 最近 100 玩家／開放房／稽核；實際 Socket 人數 |
| POST /admin/users/:id/status | admin | status（active/suspended）、reason（3–500）；不能更動自己或其他 admin |
| POST /admin/announcements | admin | title（1–80）、body（1–2000） |
| GET /health | 無 | PostgreSQL 連線健康；未涵蓋其他依賴 |

## Socket.IO

握手：`io(API,{auth:{token:accessToken}})`。Access Token 輪替後必須用新 token 重新連線。斷線後房間資格保留，重新連線會加入自己的房間。

| 方向／事件 | 輸入／輸出 |
|---|---|
| client → room:subscribe | `{id:roomId}`；需成員資格，ack `{ok:true,data:room}` 或 `{ok:false,error}` |
| client → room:chat | `{id:roomId,body:text}`，1–500 字；驗證後存 DB；ack 同上 |
| server → room:update | 完整房間快照（成員及最近 50 則訊息） |
| server → room:removed | `{id:roomId}`；被踢或主動離房時解除訂閱 |
| server → lobby:changed | 無敏感內容，通知客戶端重新讀取自己的 /lobby |
| server → session:expired | JWT 過期，關閉 Socket；客戶端輪替 refresh token 後重連 |

HTTP 限流以直連 IP 存 PostgreSQL（auth 路徑每分鐘 50 次，其餘 500）；WS 動作以 user id 每分鐘 60 次。反向代理部署要設定可信代理規則與入口層限流，不能無條件信任客戶端 X-Forwarded-For。過期限流 key／refresh sessions 尚無排程清理，需在營運階段加 retention job。

Redis adapter 已接入但尚未在本機實測；啟用多個 API 節點時需共同 Redis，並讓 Socket.IO polling 使用黏著工作階段或全程 WebSocket。此階段不宣稱多節點／跨網路真機驗收完成。
