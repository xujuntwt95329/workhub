import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { openDatabase, type Database } from "../server/db";
import { Service, owner } from "../server/service";
import { Assistant } from "../server/assistant";
import { createAgentToken } from "../server/auth";
import { clear, readyTask, agent } from "./fixtures";
import { contextLimit } from "../server/assistant-context";
let db: Database, s: Service, a: Assistant;
const fetcher = vi.fn<typeof fetch>();
const config = {
  baseUrl: "https://model.example/v1",
  model: "example-model",
  apiKey: "test-secret-key",
  autoSummary: false,
};
const response = (content = "An answer") =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { total_tokens: 50 },
    }),
    { status: 200 },
  );
beforeAll(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL);
  s = new Service(db);
});
beforeEach(async () => {
  await clear(db);
  fetcher.mockReset().mockImplementation(async () => response());
  a = new Assistant(
    db,
    s,
    Buffer.alloc(32, 1),
    ["https://model.example"],
    fetcher,
  );
});
afterAll(async () => db.close());
it("requires configuration and retains an encrypted key when saving non-secret settings", async () => {
  expect(await a.publicConfig(owner)).toEqual({ configured: false });
  expect(await a.tick()).toBe(false);
  await expect(a.enqueue(owner, "Question")).rejects.toMatchObject({
    code: "LLM_NOT_CONFIGURED",
  });
  await expect(
    a.configure(owner, { ...config, apiKey: undefined }),
  ).rejects.toMatchObject({ code: "KEY_REQUIRED" });
  await expect(a.configure(agent(), config)).rejects.toMatchObject({
    status: 403,
  });
  await a.configure(owner, config);
  const before = await a.config();
  await a.configure(owner, { ...config, apiKey: undefined, model: "updated" });
  expect((await a.config())?.encryptedKey).toBe(before?.encryptedKey);
  expect(await a.publicConfig(owner)).toMatchObject({
    model: "updated",
    configured: true,
    calls: 0,
  });
  expect(await a.tick()).toBe(false);
});
it("builds scoped context, filters forged citations and does not expose secret or actor metadata", async () => {
  const f = await readyTask(s);
  await a.configure(owner, config);
  fetcher.mockResolvedValue(
    response(`[TASK](${`workhub:${f.task.id}`}) [unknown](workhub:not-real)`),
  );
  const run = await a.enqueue(owner, "What remains?", f.task.id);
  expect((await a.get(owner, run.id)).sources).toEqual([]);
  expect(await a.tick()).toBe(true);
  const done = await a.get(owner, run.id);
  expect(done.status).toBe("succeeded");
  expect(done.answer).toContain("来源未核实");
  expect(done.sources).toMatchObject([{ id: f.task.id, version: 1 }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("https://model.example/v1/chat/completions");
  expect(JSON.parse(String(request?.body)).messages[1].content).toContain(
    "Article search",
  );
  expect(request?.body).not.toContain(config.apiKey);
  expect((await a.publicConfig(owner)) as any).toMatchObject({ calls: 1 });
});
it("enforces agent invocation scopes and rechecks credential revocation before sending context", async () => {
  await a.configure(owner, config);
  const f = await readyTask(s);
  await expect(a.enqueue(agent(), "Question", f.task.id)).rejects.toMatchObject(
    { status: 403 },
  );
  const token = await createAgentToken(
    db,
    "Agent",
    [f.task.id],
    ["read", "assistant:invoke"],
  );
  const actor = {
    ...agent([f.task.id], ["read", "assistant:invoke"]),
    id: token.id,
  };
  await expect(a.enqueue(actor, "Global question")).rejects.toMatchObject({
    status: 403,
  });
  await expect(a.enqueue(actor, "Question", "unknown")).rejects.toThrow();
  const run = await a.enqueue(actor, "Question", f.task.id);
  await db.query("UPDATE tokens SET revoked=true WHERE id=$1", [token.id]);
  await a.tick();
  expect((await a.get(owner, run.id)).error).toContain("撤销");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await a.publicConfig(owner)).toMatchObject({ calls: 0 });
  await expect(a.get(agent(["other"]), run.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    a.cancel(agent([f.task.id], ["read"]), run.id),
  ).rejects.toMatchObject({ status: 403 });
});
it("executes global and task agent requests only when credentials remain valid", async () => {
  await a.configure(owner, config);
  const token = await createAgentToken(
    db,
    "Global",
    ["*"],
    ["read", "assistant:invoke"],
  );
  const actor = { ...agent(["*"], ["read", "assistant:invoke"]), id: token.id };
  const run = await a.enqueue(actor, "List ideas");
  await a.tick();
  expect((await a.get(actor, run.id)).status).toBe("succeeded");
  await expect(a.get(agent(["some-task"]), run.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(a.enqueue(owner, "")).rejects.toMatchObject({
    code: "INVALID_QUESTION",
  });
  await expect(a.get(owner, "missing")).rejects.toMatchObject({ status: 404 });
});
it("tracks summary freshness and queues a newer summary if context changes mid-generation", async () => {
  const f = await readyTask(s);
  await a.configure(owner, config);
  expect(await a.summary(owner, f.task.id)).toBeNull();
  fetcher.mockImplementationOnce(async () => {
    await s.update(owner, f.task.id, 1, { body: "Changed during generation" });
    return response("Earlier context");
  });
  const job = await a.enqueue(owner, "Summarize", f.task.id, true);
  await a.tick();
  expect((await a.get(owner, job.id)).status).toBe("succeeded");
  expect((await a.summary(owner, f.task.id))?.stale).toBe(true);
  expect(
    (await db.query("SELECT id FROM assistant_runs WHERE status='queued'"))
      .rows,
  ).toHaveLength(1);
  await a.tick();
  expect((await a.summary(owner, f.task.id))?.stale).toBe(false);
  expect(a.fingerprint({ x: 1, asOf: "before", generatedAt: "before" })).toBe(
    a.fingerprint({ x: 1, asOf: "after", generatedAt: "after" }),
  );
});
it("honors queued/running cancellation and never overwrites it with a late response", async () => {
  await a.configure(owner, config);
  const queued = await a.enqueue(owner, "Cancelled before start");
  await a.cancel(owner, queued.id);
  expect(await a.tick()).toBe(false);
  const run = await a.enqueue(owner, "Cancelled in flight");
  fetcher.mockImplementationOnce(async () => {
    await a.cancel(owner, run.id);
    return response("Too late");
  });
  await a.tick();
  expect((await a.get(owner, run.id)).status).toBe("cancelled");
});
it.each([
  [
    "HTTP failure",
    () =>
      Promise.resolve(new Response("key in provider error", { status: 500 })),
    "模型服务返回 500",
  ],
  [
    "empty response",
    () => Promise.resolve(new Response("{}", { status: 200 })),
    "有效文本",
  ],
  [
    "network error",
    () => Promise.reject(new Error("Bearer secret-provider-key")),
    "[已隐藏]",
  ],
] as const)(
  "records safe errors for %s",
  async (_name, implementation, expected) => {
    await a.configure(owner, config);
    fetcher.mockImplementationOnce(implementation);
    const run = await a.enqueue(owner, "Question");
    await a.tick();
    const result = await a.get(owner, run.id);
    expect(result.status).toBe("failed");
    expect(result.error).toContain(expected);
    expect(result.error).not.toContain("secret-provider-key");
  },
);
it("enforces and resets a daily budget atomically", async () => {
  await a.configure(owner, { ...config, dailyLimit: 1 });
  const one = await a.enqueue(owner, "One");
  const two = await a.enqueue(owner, "Two");
  await a.tick();
  await a.tick();
  expect((await a.get(owner, one.id)).status).toBe("succeeded");
  expect((await a.get(owner, two.id)).error).toContain("限额");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const c = await a.config();
  await db.query("UPDATE settings SET value=$1 WHERE key='llm'", [
    JSON.stringify({ ...c, callsDate: "2020-01-01" }),
  ]);
  expect((await a.publicConfig(owner)) as any).toMatchObject({ calls: 0 });
  const three = await a.enqueue(owner, "Next day");
  await a.tick();
  expect((await a.get(owner, three.id)).status).toBe("succeeded");
});
it("preserves a concurrent provider request count when saving model settings", async () => {
  await a.configure(owner, config);
  await a.enqueue(owner, "A real attempt");
  const configRead = a.config.bind(a);
  const spy = vi.spyOn(a, "config").mockImplementationOnce(async () => {
    const before = await configRead();
    await a.tick();
    return before;
  });
  await a.configure(owner, {
    ...config,
    apiKey: undefined,
    model: "new-model",
  });
  spy.mockRestore();
  expect(await a.publicConfig(owner)).toMatchObject({
    calls: 1,
    model: "new-model",
  });
});
it("recovers an expired lease once and fails repeatedly interrupted jobs", async () => {
  await a.configure(owner, config);
  const recover = await a.enqueue(owner, "Retry");
  const exhausted = await a.enqueue(owner, "Stop retrying");
  await db.query(
    "UPDATE assistant_runs SET status='running',attempts=1,lease_until=now()-interval '1 minute' WHERE id=$1",
    [recover.id],
  );
  await db.query(
    "UPDATE assistant_runs SET status='running',attempts=2,lease_until=now()-interval '1 minute' WHERE id=$1",
    [exhausted.id],
  );
  await a.tick();
  expect((await a.get(owner, recover.id)).status).toBe("succeeded");
  expect((await a.get(owner, exhausted.id)).status).toBe("failed");
});
it("compacts a large workspace instead of refusing it, and fails queued jobs when removed", async () => {
  await a.configure(owner, config);
  for (let i = 0; i < 8; i++)
    await s.create(owner, {
      kind: "todo",
      title: "Long " + i,
      body: "x".repeat(20000),
    });
  const run = await a.enqueue(owner, "Everything");
  await a.tick();
  expect((await a.get(owner, run.id)).status).toBe("succeeded");
  const data = JSON.parse(
    JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[1].content,
  ).engineeringData;
  expect(JSON.stringify(data).length).toBeLessThanOrEqual(contextLimit);
  expect(data.coverage.shortenedRecords).toBe(8);
  expect(data.counts.todo).toBe(8);
  const pending = await a.enqueue(owner, "Another");
  await a.remove(owner);
  expect((await a.get(owner, pending.id)).status).toBe("failed");
});

it("answers and summarizes a large selected task using deduplicated scoped records and exact quality totals", async () => {
  await a.configure(owner, config);
  const f = await readyTask(s);
  await s.update(owner, f.requirement.id, 1, {
    body: "文章搜索的详细要求。".repeat(1500),
  });
  for (let i = 0; i < 8; i++)
    await s.create(owner, {
      kind: "design",
      taskId: f.task.id,
      title: "Design section " + i,
      body: "Details ".repeat(2400),
    });
  await s.create(owner, {
    kind: "todo",
    title: "Outside this task",
    body: "NOT IN SELECTED SCOPE",
  });
  const original = await s.context(owner, f.task.id);
  expect(JSON.stringify(original).length).toBeGreaterThan(140000);
  const run = await a.enqueue(owner, "搜索有哪些质量缺口？", f.task.id);
  await a.tick();
  expect((await a.get(owner, run.id)).status).toBe("succeeded");
  const packet = JSON.parse(
    JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[1].content,
  ).engineeringData;
  expect(packet.scope).toBe("task");
  expect(packet.taskId).toBe(f.task.id);
  expect(packet.report.metrics).toEqual(original.report!.metrics);
  expect(packet.report.gapCount).toBe(original.report!.gaps.length);
  expect(JSON.stringify(packet)).not.toContain("NOT IN SELECTED SCOPE");
  expect(
    packet.records.filter((r: any) => r.id === f.requirement.id),
  ).toHaveLength(1);
  const summary = await a.enqueue(owner, "Summarize", f.task.id, true);
  expect((await a.summaryState(owner, f.task.id)).latestRun).toMatchObject({
    id: summary.id,
    status: "queued",
  });
  await a.tick();
  expect((await a.summaryState(owner, f.task.id)).data).toMatchObject({
    answer: "An answer",
    stale: false,
  });
  expect(await a.publicConfig(owner)).toMatchObject({ calls: 2 });
});

it("separates adopted principle versions and excluded requirements from active counts", async () => {
  const f = await readyTask(s);
  const p = await s.create(owner, {
    kind: "principle",
    taskId: f.task.id,
    title: "Validate inputs",
    approve: true,
  });
  await s.adoptPrinciples(owner, f.task.id, f.task.version);
  await s.update(owner, p.id, p.version, { body: "A newer proposal" });
  const excluded = await s.create(owner, {
    kind: "requirement",
    taskId: f.task.id,
    title: "Later iteration",
  });
  await s.disposeRequirement(
    owner,
    excluded.id,
    excluded.version,
    "reject",
    "Future work",
  );
  await a.configure(owner, config);
  await a.enqueue(owner, "原则与需求范围是什么？", f.task.id);
  await a.tick();
  const packet = JSON.parse(
    JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[1].content,
  ).engineeringData;
  expect(packet.counts.principle).toBe(1);
  expect(packet.counts.requirement).toBe(1);
  expect(packet.excludedRequirementCount).toBe(1);
  expect(packet.records.filter((r: any) => r.id === p.id)).toHaveLength(2);
  expect(
    packet.records.find((r: any) => r.id === p.id && r.version === 1)
      .adoptedPrincipleVersion,
  ).toBe(true);
});

it("coalesces repeated summary requests and reports failures while retaining the previous successful summary", async () => {
  const f = await readyTask(s);
  await a.configure(owner, config);
  await expect(
    a.enqueue(owner, "Summary", undefined, true),
  ).rejects.toMatchObject({ code: "TASK_REQUIRED" });
  await expect(
    a.enqueue(owner, "Question", f.project.id),
  ).rejects.toMatchObject({ code: "INVALID_KIND" });
  const [one, duplicate] = await Promise.all([
    a.enqueue(owner, "Summarize", f.task.id, true),
    a.enqueue(owner, "Summarize again", f.task.id, true),
  ]);
  expect(one.id).toBe(duplicate.id);
  fetcher.mockImplementationOnce(async () => {
    expect((await a.enqueue(owner, "While running", f.task.id, true)).id).toBe(
      one.id,
    );
    expect((await a.summaryState(owner, f.task.id)).latestRun).toMatchObject({
      status: "running",
    });
    return response("Previous useful summary");
  });
  await a.tick();
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  const retry = await a.enqueue(owner, "Refresh", f.task.id, true);
  await a.tick();
  const state = await a.summaryState(owner, f.task.id);
  expect(state.data).toMatchObject({ answer: "Previous useful summary" });
  expect(state.latestRun).toMatchObject({
    id: retry.id,
    status: "failed",
    error: "模型服务返回 503",
  });
  expect(await a.publicConfig(owner)).toMatchObject({
    calls: 2,
    recentFailures: [{ id: retry.id }],
  });
  await expect(
    a.summaryState(agent(["other"]), f.task.id),
  ).rejects.toMatchObject({ status: 403 });
});

it("deducts only proven legacy local context failures once without resetting real provider requests", async () => {
  await a.configure(owner, config);
  const current = await a.config();
  await db.query("UPDATE settings SET value=$1 WHERE key='llm'", [
    JSON.stringify({
      ...current,
      calls: 4,
      callsDate: new Date().toISOString().slice(0, 10),
      usageVersion: undefined,
    }),
  ]);
  for (const [id, error, date] of [
    ["local1", "此范围内容过多，请缩小到单个任务", new Date().toISOString()],
    ["local2", "此范围内容过多，请缩小到单个任务", new Date().toISOString()],
    ["provider", "模型服务返回 500", new Date().toISOString()],
    ["yesterday", "此范围内容过多，请缩小到单个任务", "2020-01-01T00:00:00Z"],
  ])
    await db.query(
      "INSERT INTO assistant_runs(id,question,status,error,finished_at) VALUES($1,'Question','failed',$2,$3)",
      [id, error, date],
    );
  const [first, second] = await Promise.all([
    a.publicConfig(owner),
    a.publicConfig(owner),
  ]);
  expect(first).toMatchObject({ calls: 2, localFailuresExcluded: 2 });
  expect(second).toMatchObject({ calls: 2, localFailuresExcluded: 2 });
  const run = await a.enqueue(owner, "Real request");
  await a.tick();
  expect((await a.get(owner, run.id)).status).toBe("succeeded");
  expect(await a.publicConfig(owner)).toMatchObject({
    calls: 3,
    localFailuresExcluded: 2,
  });
});

it("does not spend budget when a job is cancelled during preparation or decryption fails", async () => {
  await a.configure(owner, config);
  const run = await a.enqueue(owner, "Cancel before sending");
  const context = s.context.bind(s);
  const spy = vi.spyOn(s, "context").mockImplementationOnce(async (...args) => {
    await a.cancel(owner, run.id);
    return context(...args);
  });
  await a.tick();
  spy.mockRestore();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await a.publicConfig(owner)).toMatchObject({ calls: 0 });
  const failed = await a.enqueue(owner, "Bad encryption");
  const wrongKey = new Assistant(
    db,
    s,
    Buffer.alloc(32, 5),
    ["https://model.example"],
    fetcher,
  );
  await wrongKey.tick();
  expect((await a.get(owner, failed.id)).status).toBe("failed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await a.publicConfig(owner)).toMatchObject({ calls: 0 });
});
