import { openDatabase } from "../server/db";
import { buildApp } from "../server/app";
import { createServer } from "node:http";
// Deterministic local provider: exercise real HTTP/worker/UI wiring without paid calls.
const provider = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  res.setHeader("content-type", "application/json");
  if (body.model === "fixture-error") {
    res
      .writeHead(503)
      .end(JSON.stringify({ error: "Synthetic provider failure" }));
    return;
  }
  const packet = JSON.parse(body.messages[1].content).engineeringData;
  if (JSON.stringify(packet).length > 60000) {
    res.writeHead(413).end("{}");
    return;
  }
  const task = packet.records.find((r: { kind: string }) => r.kind === "task");
  const answer =
    packet.scope === "task"
      ? `已读取选定任务：[${task.key}](workhub:${task.id})。共有 ${packet.counts.design ?? 0} 份设计。工程记录已整理。`
      : "已读取工作空间的工程记录。";
  res.end(
    JSON.stringify({
      choices: [{ message: { content: answer } }],
      usage: { total_tokens: 42 },
    }),
  );
});
await new Promise<void>((resolve) =>
  provider.listen(3102, "127.0.0.1", resolve),
);
const db = await openDatabase();
const { app, assistant } = await buildApp(db, {
  publicUrl: "http://127.0.0.1:3101",
  production: false,
  encryptionKey: Buffer.alloc(32, 9),
  // Many complete browser workflows run within a minute against this isolated server.
  // Login/setup limits retain their route-specific defaults.
  rateLimitMax: 6000,
  allowedLlmOrigins: ["http://127.0.0.1:3102"],
});
let busy = false;
const worker = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await assistant.tick();
  } finally {
    busy = false;
  }
}, 100);
await app.listen({ host: "127.0.0.1", port: 3101 });
process.on("SIGTERM", async () => {
  clearInterval(worker);
  provider.close();
  await app.close();
  await db.close();
  process.exit(0);
});
