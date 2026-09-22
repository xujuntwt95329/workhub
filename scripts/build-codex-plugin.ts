import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCodexPlugin } from "../server/codex-plugin.js";

// Offline packaging only: no credentials, database, model calls or installation.
const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173";
for (const authentication of ["oauth", "token"] as const) {
  const directory = resolve("artifacts/codex-plugin", authentication);
  mkdirSync(directory, { recursive: true });
  const artifact = buildCodexPlugin({
    target: "codex",
    authentication,
    baseUrl,
  });
  writeFileSync(resolve(directory, artifact.filename), artifact.buffer);
  console.log(
    `${authentication}/${artifact.filename} sha256:${artifact.sha256}`,
  );
}
