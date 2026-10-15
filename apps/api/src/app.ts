import {
  Module,
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Db } from "./db";
import { Auth, AuthGuard, AuthController, MeController } from "./auth";
import { Rooms, RoomEvents, RoomsController } from "./rooms";
import { Presence, Realtime } from "./realtime";
import { LobbyController, AdminController } from "./platform";
import { Limits } from "./limits";
@Controller("health")
class Health {
  constructor(private db: Db) {}
  @Get() async check() {
    try {
      await this.db.query("SELECT 1");
      return { ok: true, database: "up" };
    } catch {
      throw new ServiceUnavailableException("資料庫無法使用");
    }
  }
}
@Module({
  controllers: [
    AuthController,
    MeController,
    RoomsController,
    LobbyController,
    AdminController,
    Health,
  ],
  providers: [
    Db,
    Auth,
    AuthGuard,
    Rooms,
    RoomEvents,
    Presence,
    Realtime,
    Limits,
  ],
})
export class AppModule {}
