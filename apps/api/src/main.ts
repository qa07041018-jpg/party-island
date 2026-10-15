import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, static as serveStatic } from "express";
import { resolve } from "node:path";
import helmet from "helmet";
import { AppModule } from "./app";
import { config } from "./config";
import { Limits } from "./limits";
import { webScriptHashes } from "./web-security";
export async function createApp() {
  const c = config();
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn", "log"],
    bodyParser: false,
  });
  app.use(
    helmet(
      process.env.SERVE_WEB === "1"
        ? {
            contentSecurityPolicy: {
              directives: {
                scriptSrc: ["'self'", ...webScriptHashes()],
                connectSrc: [
                  "'self'",
                  ...c.origins,
                  ...c.origins.map((s) => s.replace(/^http/, "ws")),
                ],
                upgradeInsecureRequests:
                  c.NODE_ENV === "production" ? [] : null,
              },
            },
          }
        : {},
    ),
  );
  app.use(json({ limit: "32kb" }));
  app.enableCors({ origin: c.origins, credentials: false });
  const limits = app.get(Limits);
  app.use(async (req: any, res: any, next: any) => {
    try {
      if (req.path === "/health") return next();
      await limits.check(
        `http:${req.ip}`,
        req.path.startsWith("/auth/") ? 50 : 500,
        60,
      );
      next();
    } catch (e: any) {
      res.status(e.getStatus?.() ?? 503).json({
        message:
          e.getStatus?.() === 429
            ? "操作太頻繁，請稍後再試"
            : "服務暫時無法使用",
      });
    }
  });
  if (process.env.SERVE_WEB === "1") {
    app.use(
      "/admin",
      serveStatic(resolve(__dirname, "../../admin/out"), {
        index: "index.html",
      }),
    );
    app.use(
      serveStatic(resolve(__dirname, "../../mobile/cloud-dist"), {
        index: "index.html",
      }),
    );
  }
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  createApp()
    .then((app) => app.listen(config().PORT, config().HOST))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
