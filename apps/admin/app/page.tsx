"use client";
import { useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export default function Admin() {
  const [access, setAccess] = useState(""),
    [refresh, setRefresh] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [reason, setReason] = useState("");
  async function call(
    path: string,
    method = "GET",
    payload?: unknown,
    t = access,
  ): Promise<any> {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.message ?? "操作失敗");
    return d;
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function load(t = access) {
    setData(await call("/admin/overview", "GET", undefined, t));
  }
  return (
    <main>
      <header>
        <div>
          <small>PARTY ISLAND / CONTROL CENTER</small>
          <h1>玩伴島管理中心</h1>
          <p>伺服器授權・真實資料・操作留痕</p>
        </div>
        {data ? (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await call("/auth/logout", "POST", { refreshToken: refresh });
                setAccess("");
                setRefresh("");
                setData(null);
              })
            }
          >
            登出
          </button>
        ) : null}
      </header>
      {error ? (
        <div role="alert" className="error">
          {error}
        </div>
      ) : null}
      {!data ? (
        <form
          className="login panel"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const s = await call("/auth/login", "POST", { email, password });
              if (s.user.role !== "admin") {
                await call(
                  "/auth/logout",
                  "POST",
                  { refreshToken: s.refreshToken },
                  s.accessToken,
                );
                throw Error("此帳號沒有系統管理員權限");
              }
              setAccess(s.accessToken);
              setRefresh(s.refreshToken);
              setPassword("");
              await load(s.accessToken);
            });
          }}
        >
          <h2>管理員登入</h2>
          <label>
            電子信箱
            <input
              value={email}
              type="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            密碼
            <input
              value={password}
              type="password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? "驗證中…" : "安全登入"}</button>
          <p>
            首次請依 README 的 admin:create
            指令建立帳號。登入資訊僅保留於此分頁記憶體。
          </p>
        </form>
      ) : (
        <>
          <section className="stats">
            <div className="panel">
              <small>即時連線玩家</small>
              <strong>{data.online}</strong>
            </div>
            <div className="panel">
              <small>目前開放房間（最多顯示 100）</small>
              <strong>{data.rooms.length}</strong>
            </div>
            <div className="panel">
              <small>載入玩家（最近 100 位）</small>
              <strong>{data.users.length}</strong>
            </div>
          </section>
          <div className="toolbar">
            <h2>玩家管理</h2>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const s = await call("/auth/refresh", "POST", {
                    refreshToken: refresh,
                  });
                  setAccess(s.accessToken);
                  setRefresh(s.refreshToken);
                  await load(s.accessToken);
                })
              }
            >
              更新工作階段與資料
            </button>
          </div>
          <div className="panel">
            <label>
              停權／恢復原因（必填）
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="請填寫可供稽核的操作原因"
              />
            </label>
            <div className="table">
              <table>
                <thead>
                  <tr>
                    <th>UID</th>
                    <th>玩家</th>
                    <th>身分</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u: any) => (
                    <tr key={u.id}>
                      <td>{u.uid}</td>
                      <td>
                        {u.nickname}
                        <small>{u.email ?? "訪客"}</small>
                      </td>
                      <td>{u.role}</td>
                      <td>{u.status}</td>
                      <td>
                        {u.role !== "admin" ? (
                          <button
                            disabled={busy || reason.trim().length < 3}
                            onClick={() =>
                              run(async () => {
                                await call(
                                  `/admin/users/${u.id}/status`,
                                  "POST",
                                  {
                                    status:
                                      u.status === "suspended"
                                        ? "active"
                                        : "suspended",
                                    reason,
                                  },
                                );
                                await load();
                              })
                            }
                          >
                            {u.status === "suspended" ? "恢復" : "停權"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <section className="columns">
            <div className="panel">
              <h2>運作中的房間</h2>
              {data.rooms.length ? (
                data.rooms.map((r: any) => (
                  <article key={r.id}>
                    <b>{r.name}</b>
                    <p>
                      {r.game} · {r.state}
                    </p>
                    <small>{r.id}</small>
                  </article>
                ))
              ) : (
                <p>目前沒有房間</p>
              )}
            </div>
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await call("/admin/announcements", "POST", { title, body });
                  setTitle("");
                  setBody("");
                  await load();
                });
              }}
            >
              <h2>發布公告</h2>
              <label>
                標題
                <input
                  required
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                內容
                <textarea
                  required
                  maxLength={2000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <button disabled={busy}>發布到遊戲大廳</button>
            </form>
          </section>
          <div className="panel">
            <h2>操作稽核（最近 100 筆）</h2>
            {data.audit.length ? (
              data.audit.map((a: any) => (
                <article key={a.id}>
                  <b>{a.action}</b>
                  <p>
                    {new Date(a.created_at).toLocaleString()} · {a.target_id}
                  </p>
                  <small>{JSON.stringify(a.detail)}</small>
                </article>
              ))
            ) : (
              <p>尚無操作紀錄</p>
            )}
          </div>
        </>
      )}
      <footer>第一階段 · 尚未啟用金流、語音或遊戲引擎</footer>
    </main>
  );
}
