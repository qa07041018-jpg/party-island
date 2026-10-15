import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  parse,
  nicknameSchema,
} from "../security";
test("salted password hashes verify without retaining plaintext", async () => {
  const a = await hashPassword("very-long-password");
  const b = await hashPassword("very-long-password");
  assert.notEqual(a, b);
  assert(!a.includes("very-long-password"));
  assert(await verifyPassword("very-long-password", a));
  assert(!(await verifyPassword("wrong", a)));
  assert(!(await verifyPassword("wrong", "broken")));
});
test("nickname validation rejects empty/long input", () => {
  assert.equal(parse(nicknameSchema, "  島民  "), "島民");
  assert.throws(() => parse(nicknameSchema, ""));
  assert.throws(() => parse(nicknameSchema, "a".repeat(25)));
});
