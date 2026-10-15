import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Auth } from "./auth";
import { Rooms, RoomEvents } from "./rooms";
import { config } from "./config";
import { parse, idSchema } from "./security";
import { z } from "zod";
import { Limits } from "./limits";
import jwt from "jsonwebtoken";
@Injectable()
export class Presence {
  count: () => Promise<number> = async () => 0;
}
@WebSocketGateway({
  cors: { origin: config().origins, credentials: false },
  maxHttpBufferSize: 16384,
})
export class Realtime
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy,
    OnModuleInit
{
  @WebSocketServer() server!: Server;
  private redisClients: ReturnType<typeof createClient>[] = [];
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  constructor(
    private auth: Auth,
    private rooms: Rooms,
    private events: RoomEvents,
    private presence: Presence,
    private limits: Limits,
  ) {}
  async onModuleInit() {
    if (config().REDIS_URL) {
      const pub = createClient({
        url: config().REDIS_URL,
        socket: { connectTimeout: 5000, reconnectStrategy: false },
      });
      const sub = pub.duplicate();
      pub.on("error", (e) =>
        console.error("Redis connection error", e.message),
      );
      sub.on("error", (e) =>
        console.error("Redis subscription error", e.message),
      );
      await Promise.all([pub.connect(), sub.connect()]);
      this.server.adapter(createAdapter(pub, sub));
      this.redisClients = [pub, sub];
    }
  }
  afterInit(server: Server) {
    server.use(async (s, next) => {
      try {
        s.data.user = await this.auth.authenticate(
          s.handshake.auth.token ?? "",
        );
        s.data.expiresAt =
          (jwt.decode(s.handshake.auth.token) as jwt.JwtPayload).exp! * 1000;
        next();
      } catch {
        next(new Error("登入已失效"));
      }
    });
    this.events.notify = async (id) => {
      const clients = await server.in(id).fetchSockets();
      for (const s of clients) {
        try {
          await this.rooms.member(id, s.data.user.id);
        } catch {
          await s.leave(id);
          s.emit("room:removed", { id });
        }
      }
      server.to(id).emit("room:update", await this.rooms.snapshot(id));
      server.emit("lobby:changed");
    };
    this.events.evict = async (id, user) => {
      const sockets = await server.in(`user:${user}`).fetchSockets();
      for (const s of sockets) {
        await s.leave(id);
        s.emit("room:removed", { id });
      }
    };
    this.events.revokeUser = async (user) => {
      server.in(`user:${user}`).disconnectSockets(true);
    };
    this.presence.count = async () =>
      new Set((await server.fetchSockets()).map((s) => s.data.user.id)).size;
  }
  async handleConnection(s: Socket) {
    try {
      this.expiryTimers.set(
        s.id,
        setTimeout(
          () => {
            s.emit("session:expired");
            s.disconnect(true);
          },
          Math.max(0, s.data.expiresAt - Date.now()),
        ),
      );
      await s.join(`user:${s.data.user.id}`);
      const room = await this.rooms.current(s.data.user.id);
      if (room) await s.join(room.id);
      this.server.emit("lobby:changed");
    } catch {
      s.disconnect(true);
    }
  }
  handleDisconnect(s: Socket) {
    clearTimeout(this.expiryTimers.get(s.id));
    this.expiryTimers.delete(s.id);
    this.server?.emit("lobby:changed");
  }
  @SubscribeMessage("room:subscribe") async subscribe(
    @ConnectedSocket() s: Socket,
    @MessageBody() body: unknown,
  ) {
    return this.safe(s, async () => {
      const id = parse(idSchema, (body as any)?.id);
      await this.rooms.member(id, s.data.user.id);
      await s.join(id);
      return this.rooms.snapshot(id);
    });
  }
  @SubscribeMessage("room:chat") async chat(
    @ConnectedSocket() s: Socket,
    @MessageBody() body: unknown,
  ) {
    return this.safe(s, async () => {
      const b = parse(
        z.object({ id: idSchema, body: z.string().min(1).max(500) }).strict(),
        body,
      );
      return this.rooms.chat(s.data.user.id, b.id, { body: b.body });
    });
  }
  private async safe(s: Socket, fn: () => Promise<any>) {
    try {
      await this.auth.authenticate(s.handshake.auth.token ?? "");
      await this.limits.check(`ws:${s.data.user.id}`, 60, 60);
      return { ok: true, data: await fn() };
    } catch (e: any) {
      return {
        ok: false,
        error: e.getResponse?.()?.message ?? "服務暫時無法使用",
      };
    }
  }
  async onModuleDestroy() {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    await Promise.all(this.redisClients.map((c) => c.quit()));
  }
}
