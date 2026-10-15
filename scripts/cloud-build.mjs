import { spawnSync } from "node:child_process";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: "",
  NEXT_PUBLIC_API_URL: "",
  STATIC_ADMIN_EXPORT: "1",
};
for (const args of [
  ["--filter", "@island/api", "build"],
  ["--filter", "@island/admin", "build"],
  ["--filter", "@island/mobile", "export:web", "--clear", "--output-dir", "cloud-dist"],
]) {
  const r = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error || r.status !== 0) process.exit(r.status ?? 1);
}
