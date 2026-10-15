// Development-only preview of Expo's web export.
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("apps/mobile/dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};
createServer(async (req, res) => {
  try {
    const path = await realpath(
      resolve(
        root,
        "." +
          decodeURIComponent(
            new URL(req.url, "http://localhost").pathname === "/"
              ? "/index.html"
              : new URL(req.url, "http://localhost").pathname,
          ),
      ),
    );
    if (!path.startsWith(root + sep)) throw Error();
    res.setHeader(
      "Content-Type",
      mime[extname(path)] ?? "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(8081, "127.0.0.1", () =>
  console.log("Expo web preview: http://127.0.0.1:8081"),
);
