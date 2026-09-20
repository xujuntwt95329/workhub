import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClaudePlugin } from "../server/claude-plugin.js";

// Offline packaging for validation/release; never reads credentials or a database.
const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const directory = resolve("artifacts/claude-plugin");
mkdirSync(directory, { recursive: true });
for (const target of ["code", "desktop"] as const) {
  if (target === "desktop" && !baseUrl.startsWith("https://")) continue;
  const artifact = buildClaudePlugin({
    target,
    authentication: "oauth",
    baseUrl,
  });
  writeFileSync(resolve(directory, artifact.filename), artifact.buffer);
  console.log(`${artifact.filename}  sha256:${artifact.sha256}`);
}
