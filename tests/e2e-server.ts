import { openDatabase } from "../server/db";
import { buildApp } from "../server/app";
const db = await openDatabase();
const { app } = await buildApp(db, {
  publicUrl: "http://127.0.0.1:3101",
  production: false,
  encryptionKey: Buffer.alloc(32, 9),
});
await app.listen({ host: "127.0.0.1", port: 3101 });
process.on("SIGTERM", async () => {
  await app.close();
  await db.close();
  process.exit(0);
});
