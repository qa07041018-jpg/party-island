import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export function webScriptHashes() {
  const hashes = new Set<string>();
  for (const file of [
    "../../mobile/cloud-dist/index.html",
    "../../admin/out/index.html",
  ]) {
    const html = readFileSync(resolve(__dirname, file), "utf8");
    for (const match of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      if (!/\bsrc\s*=/i.test(match[1]) && match[2].trim())
        hashes.add(
          `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`,
        );
    }
  }
  return [...hashes];
}
