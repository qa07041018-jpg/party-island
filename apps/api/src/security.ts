import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
const derive = promisify(scrypt);
export async function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(value, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(value: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const key = (await derive(value, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export const opaque = () => randomBytes(48).toString("base64url");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new BadRequestException({
      message: "輸入格式不正確",
      issues: r.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  return r.data;
}
export const idSchema = z.uuid();
export const passwordSchema = z.string().min(10).max(128);
export const nicknameSchema = z.string().trim().min(2).max(24);
