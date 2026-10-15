import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(48),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  CORS_ORIGINS: z.string().optional(),
  REDIS_URL: z.string().optional(),
});
export function config() {
  const c = schema.parse(process.env);
  const origins = (c.CORS_ORIGINS || process.env.RENDER_EXTERNAL_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origins.length || origins.some((s) => s.includes("*")))
    throw new Error("Explicit CORS origins required");
  return { ...c, origins };
}
