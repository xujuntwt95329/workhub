import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.DATABASE_URL ||
    !process.env.KEY_ENCRYPTION_KEY ||
    !process.env.SETUP_TOKEN ||
    !process.env.PUBLIC_URL?.startsWith("https://"))
)
  throw new Error(
    "生产环境需要 DATABASE_URL、KEY_ENCRYPTION_KEY、SETUP_TOKEN 和 HTTPS PUBLIC_URL",
  );
await mkdir(".data", { recursive: true });
let key: Buffer;
if (process.env.KEY_ENCRYPTION_KEY)
  key = Buffer.from(process.env.KEY_ENCRYPTION_KEY, "hex");
else {
  try {
    key = await readFile(".data/master.key");
  } catch {
    key = randomBytes(32);
    await writeFile(".data/master.key", key, { mode: 0o600 });
  }
}
if (key.length !== 32)
  throw new Error("KEY_ENCRYPTION_KEY 必须为 64 位十六进制密钥");
const db = await openDatabase(
  process.env.DATABASE_URL,
  process.env.DATA_DIR ?? ".data/postgres",
);
const { app, assistant } = await buildApp(db, {
  production,
  publicUrl: process.env.PUBLIC_URL ?? "http://127.0.0.1:5173",
  setupToken: process.env.SETUP_TOKEN,
  encryptionKey: key,
  logger: true,
  allowedLlmOrigins: (process.env.LLM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean),
});
let busy = false;
const worker = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await assistant.tick();
  } catch (e) {
    app.log.error(e);
  } finally {
    busy = false;
  }
}, 2000);
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
async function close() {
  clearInterval(worker);
  await app.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
