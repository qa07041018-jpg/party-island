import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { Db } from "../db";
import { migrate } from "../scripts/migrate";
import { bootstrapAdmin } from "../bootstrap";
import { verifyPassword } from "../security";
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
  throw Error("TEST_DATABASE_URL must use a separate database ending in _test");
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
const { createApp } = require("../main") as typeof import("../main");
test("real PostgreSQL + HTTP + two Socket.IO players", async (t) => {
  let app = await createApp();
  const db = app.get(Db);
  await migrate(db);
  await app.listen(0, "127.0.0.1");
  let base = await app.getUrl();
  const sockets: Socket[] = [];
  const suffix = Date.now();
  let a: any, b: any, c: any;
  let room: any;
  async function api(
    path: string,
    method = "GET",
    body?: any,
    access?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  }
  async function socket(access: string) {
    const s = io(base, {
      auth: { token: access },
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", reject);
    });
    return s;
  }
  try {
    await t.test(
      "register/login/guest/UID, reject duplicates and invalid input",
      async () => {
        a = (
          await api("/auth/register", "POST", {
            email: `a${suffix}@example.test`,
            password: "testing-password-123",
            nickname: "測試甲",
          })
        ).data;
        b = (
          await api("/auth/register", "POST", {
            email: `b${suffix}@example.test`,
            password: "testing-password-456",
            nickname: "測試乙",
          })
        ).data;
        c = (await api("/auth/guest", "POST", { nickname: "測試丙" })).data;
        assert(a.accessToken && b.accessToken && c.accessToken);
        assert.notEqual(a.user.uid, b.user.uid);
        assert.equal(
          (
            await api("/auth/login", "POST", {
              email: `a${suffix}@example.test`,
              password: "testing-password-123",
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await api("/auth/login", "POST", {
              email: `a${suffix}@example.test`,
              password: "wrong",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api("/auth/register", "POST", {
              email: `a${suffix}@example.test`,
              password: "testing-password-123",
              nickname: "重複",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/auth/register", "POST", {
              email: "invalid",
              password: "short",
              nickname: "甲",
            })
          ).status,
          400,
        );
        assert.equal((await api("/me")).status, 401);
        assert.equal(
          (await api("/admin/overview", "GET", undefined, a.accessToken))
            .status,
          403,
        );
      },
    );
    await t.test("profile/wallet data originate from PostgreSQL", async () => {
      const r = await api(
        "/me",
        "PATCH",
        { nickname: "新島民甲", avatarColor: "#abcdef" },
        a.accessToken,
      );
      assert.equal(r.data.nickname, "新島民甲");
      const l = await api("/lobby", "GET", undefined, a.accessToken);
      assert.deepEqual(l.data.wallet, { coins: "0", diamonds: "0" });
      assert.equal(l.data.games.filter((g: any) => g.available).length, 1);
    });
    await t.test(
      "private rooms hidden, password protected, snapshots restricted",
      async () => {
        room = (
          await api(
            "/rooms",
            "POST",
            {
              name: "整合測試私人房",
              visibility: "private",
              capacity: 2,
              password: "safe-room",
            },
            a.accessToken,
          )
        ).data;
        assert(room.id);
        assert(!JSON.stringify(room).includes("safe-room"));
        assert(
          !(await api("/rooms", "GET", undefined, b.accessToken)).data.some(
            (x: any) => x.id === room.id,
          ),
        );
        assert.equal(
          (await api(`/rooms/${room.id}`, "GET", undefined, b.accessToken))
            .status,
          403,
        );
        assert.equal(
          (
            await api(
              `/rooms/${room.id}/join`,
              "POST",
              { password: "bad" },
              b.accessToken,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "simultaneous join enforces capacity and unique seats",
      async () => {
        const responses = await Promise.all(
          [b, c].map((u) =>
            api(
              `/rooms/${room.id}/join`,
              "POST",
              { password: "safe-room" },
              u.accessToken,
            ),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        if (responses[0].status !== 201) [b, c] = [c, b];
        const snap = (
          await api(`/rooms/${room.id}`, "GET", undefined, a.accessToken)
        ).data;
        assert.equal(snap.members.length, 2);
        assert.equal(new Set(snap.members.map((x: any) => x.seat)).size, 2);
        assert.equal(
          (
            await api(
              "/rooms",
              "POST",
              { name: "重複建立", visibility: "public", capacity: 2 },
              a.accessToken,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "two authenticated clients sync chat and reconnect without losing membership",
      async () => {
        const sa = await socket(a.accessToken);
        const sb = await socket(b.accessToken);
        await new Promise<void>((resolve, reject) =>
          sa.emit("room:subscribe", { id: room.id }, (r: any) =>
            r.ok ? resolve() : reject(Error(r.error)),
          ),
        );
        await new Promise<void>((resolve, reject) =>
          sb.emit("room:subscribe", { id: room.id }, (r: any) =>
            r.ok ? resolve() : reject(Error(r.error)),
          ),
        );
        const update = new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("room:update timeout")),
            5000,
          );
          sb.once("room:update", (r) => {
            clearTimeout(timer);
            resolve(r);
          });
        });
        const ack = await new Promise<any>((resolve) =>
          sa.emit(
            "room:chat",
            { id: room.id, body: "跨帳號同步訊息" },
            resolve,
          ),
        );
        assert(ack.ok);
        assert(
          (await update).messages.some((m: any) => m.body === "跨帳號同步訊息"),
        );
        sb.disconnect();
        const again = await socket(b.accessToken);
        assert(again.connected);
        assert.equal(
          (await api("/rooms/current", "GET", undefined, b.accessToken)).data
            .id,
          room.id,
        );
        const outside = await socket(c.accessToken);
        const denied = await new Promise<any>((resolve) =>
          outside.emit("room:chat", { id: room.id, body: "闖入訊息" }, resolve),
        );
        assert.equal(denied.ok, false);
      },
    );
    await t.test(
      "unauthorized kick rejected, owner transfer and room closure persisted",
      async () => {
        assert.equal(
          (
            await api(
              `/rooms/${room.id}/kick`,
              "POST",
              { userId: a.user.id },
              b.accessToken,
            )
          ).status,
          403,
        );
        await api(`/rooms/${room.id}/leave`, "POST", {}, a.accessToken);
        assert.equal(
          (await api(`/rooms/${room.id}`, "GET", undefined, b.accessToken)).data
            .owner_id,
          b.user.id,
        );
        await api(`/rooms/${room.id}/leave`, "POST", {}, b.accessToken);
        assert.equal(
          (await db.query("SELECT state FROM rooms WHERE id=$1", [room.id]))
            .rows[0].state,
          "closed",
        );
        room = (
          await api(
            "/rooms",
            "POST",
            { name: "重啟保留房", visibility: "public", capacity: 3 },
            a.accessToken,
          )
        ).data;
        await api(`/rooms/${room.id}/join`, "POST", {}, b.accessToken);
      },
    );
    await t.test(
      "room owner ban removes member and prevents rejoining",
      async () => {
        assert.equal(
          (
            await api(
              `/rooms/${room.id}/kick`,
              "POST",
              { userId: b.user.id },
              a.accessToken,
            )
          ).status,
          201,
        );
        assert.equal(
          (await api(`/rooms/${room.id}/join`, "POST", {}, b.accessToken))
            .status,
          403,
        );
      },
    );
    await t.test(
      "refresh rotation detects replay and revokes newly issued family token",
      async () => {
        const r = await api("/auth/refresh", "POST", {
          refreshToken: b.refreshToken,
        });
        assert.equal(r.status, 201);
        assert.equal(
          (await api("/auth/refresh", "POST", { refreshToken: b.refreshToken }))
            .status,
          401,
        );
        assert.equal(
          (
            await api("/auth/refresh", "POST", {
              refreshToken: r.data.refreshToken,
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "admin operations authorized and audited; suspension blocks existing access token",
      async () => {
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [
          a.user.id,
        ]);
        assert.equal(
          (await api("/admin/overview", "GET", undefined, a.accessToken))
            .status,
          200,
        );
        assert.equal(
          (
            await api(
              `/admin/users/${c.user.id}/status`,
              "POST",
              { status: "suspended", reason: "整合測試停權" },
              a.accessToken,
            )
          ).status,
          201,
        );
        assert.equal(
          (await api("/me", "GET", undefined, c.accessToken)).status,
          401,
        );
        assert(
          (
            await db.query("SELECT 1 FROM audit_logs WHERE target_id=$1", [
              c.user.id,
            ])
          ).rowCount,
        );
      },
    );
    await t.test(
      "initial admin bootstrap is isolated, idempotent and cannot promote a player",
      async () => {
        const schema = `bootstrap_${Date.now()}`;
        await db.query(`CREATE SCHEMA "${schema}"`);
        const scopedUrl = new URL(testUrl!);
        scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
        const previous = process.env.DATABASE_URL;
        process.env.DATABASE_URL = scopedUrl.toString();
        const scoped = new Db();
        process.env.DATABASE_URL = previous;
        try {
          await migrate(scoped);
          await scoped.query(
            "INSERT INTO users(email,password_hash,nickname) VALUES('player@example.test','placeholder','普通玩家')",
          );
          await assert.rejects(() =>
            bootstrapAdmin(
              scoped,
              "player@example.test",
              "bootstrap-password-123",
            ),
          );
          assert.equal(
            (
              await scoped.query(
                "SELECT role FROM users WHERE email='player@example.test'",
              )
            ).rows[0].role,
            "player",
          );
          assert.equal(
            await bootstrapAdmin(
              scoped,
              "owner@example.test",
              "bootstrap-password-123",
            ),
            true,
          );
          assert.equal(
            await bootstrapAdmin(
              scoped,
              "owner@example.test",
              "different-password-456",
            ),
            false,
          );
          const owner = (
            await scoped.query(
              "SELECT role,password_hash FROM users WHERE email='owner@example.test'",
            )
          ).rows[0];
          assert.equal(owner.role, "admin");
          assert(
            await verifyPassword("bootstrap-password-123", owner.password_hash),
          );
          assert.equal(
            (
              await scoped.query(
                "SELECT count(*)::int n FROM audit_logs WHERE action='system.bootstrap'",
              )
            ).rows[0].n,
            1,
          );
        } finally {
          await scoped.onModuleDestroy();
          await db.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      },
    );
    await t.test(
      "service restart preserves account profile and room in real database",
      async () => {
        sockets.forEach((s) => s.disconnect());
        await app.close();
        app = await createApp();
        await app.listen(0, "127.0.0.1");
        base = await app.getUrl();
        assert.equal(
          (await api("/me", "GET", undefined, a.accessToken)).data.nickname,
          "新島民甲",
        );
        assert.equal(
          (await api("/rooms/current", "GET", undefined, a.accessToken)).data
            .id,
          room.id,
        );
      },
    );
  } finally {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  }
});
