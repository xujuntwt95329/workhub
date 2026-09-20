import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { openDatabase, type Database } from "../server/db";
import { Service, owner } from "../server/service";
import { clear, readyTask, agent, sha } from "./fixtures";
let db: Database, s: Service;
beforeAll(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL);
  s = new Service(db);
});
beforeEach(async () => clear(db));
afterAll(async () => db.close());
describe("transactional records and concurrent agents", () => {
  it("creates a complete graph with immutable history and readable scoped context", async () => {
    const f = await readyTask(s);
    expect((await s.report(owner, f.task.id)).gaps).toEqual([]);
    expect((await s.list(agent([f.task.id]))).length).toBe(5);
    expect((await s.context(owner, f.task.id)).records).toHaveLength(4);
    expect((await s.context(owner)).records).toHaveLength(6);
    expect(await s.history(owner, f.criterion.id)).toHaveLength(1);
    await expect(s.read(agent(["other"]), f.task.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(s.get("missing")).rejects.toMatchObject({ status: 404 });
  });
  it("atomically replays an identical request and rejects key reuse with a different body", async () => {
    const input = { kind: "todo", title: "Idea" };
    const [a, b] = await Promise.all([
      s.create(owner, input, "same"),
      s.create(owner, input, "same"),
    ]);
    expect(a.id).toBe(b.id);
    expect(await s.all()).toHaveLength(1);
    await expect(
      s.create(owner, { ...input, title: "Other" }, "same"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(s.create(owner, input, "x".repeat(201))).rejects.toMatchObject(
      { code: "INVALID_KEY" },
    );
  });
  it("allows only one concurrent update from the same version and preserves prior approved content", async () => {
    const f = await readyTask(s);
    const results = await Promise.allSettled([
      s.update(owner, f.requirement.id, 1, { body: "A" }),
      s.update(owner, f.requirement.id, 1, { body: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const r = await s.get(f.requirement.id);
    expect(r.version).toBe(2);
    expect(r.approvedVersion).toBe(1);
    const history = await s.history(owner, r.id);
    expect(history).toHaveLength(2);
    expect((history[1].snapshot as any).body).toBe("");
    await expect(s.approve(owner, r.id, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await s.requestReview(agent(), r.id, 2, "review");
    await s.approve(owner, r.id, 2, "Reviewed");
    expect((await s.get(r.id)).approvedVersion).toBe(2);
  });
  it("rejects invalid relationships and rolls back the entire mutation", async () => {
    const f = await readyTask(s);
    const before = (await s.all()).length;
    for (const input of [
      { kind: "requirement", title: "No task" },
      { kind: "task", title: "No project" },
      {
        kind: "task",
        title: "Nested",
        taskId: f.task.id,
        projectId: f.project.id,
      },
      { kind: "project", title: "Nested", projectId: f.project.id },
      { kind: "requirement", title: "Wrong task", taskId: f.project.id },
      { kind: "task", title: "Wrong project", projectId: f.task.id },
      {
        kind: "criterion",
        title: "Wrong parent",
        taskId: f.task.id,
        data: { requirementId: f.check.id },
      },
      {
        kind: "check",
        title: "Wrong criterion",
        taskId: f.task.id,
        data: { criterionIds: [f.requirement.id] },
      },
      { kind: "principle", title: "Scope", data: { scope: "project" } },
      { kind: "principle", title: "Scope", data: { scope: "task" } },
      {
        kind: "principle",
        title: "Scope",
        projectId: f.project.id,
        data: { scope: "global" },
      },
    ])
      await expect(s.create(owner, input)).rejects.toThrow();
    expect(await s.all()).toHaveLength(before);
  });
  it("rejects cross-task associations and unauthorized scope changes", async () => {
    const f = await readyTask(s);
    const other = await s.create(owner, {
      kind: "task",
      title: "Other",
      projectId: f.project.id,
    });
    await expect(
      s.create(owner, {
        kind: "criterion",
        title: "Cross link",
        taskId: other.id,
        data: { requirementId: f.requirement.id },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(
      s.create(agent([f.task.id]), { kind: "todo", title: "Global" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.create(agent([other.id]), {
        kind: "issue",
        title: "Outside",
        taskId: f.task.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.create(agent(), {
        kind: "principle",
        title: "Self approved",
        taskId: f.task.id,
        approve: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.create(agent(), {
        kind: "criterion",
        title: "Excluded",
        taskId: f.task.id,
        data: {
          requirementId: f.requirement.id,
          applicable: false,
          exclusionReason: "skip",
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("prevents protected-field writes and agents lowering workflow gates", async () => {
    const f = await readyTask(s);
    await expect(
      s.create(owner, {
        kind: "todo",
        title: "Spoofed",
        data: { targetTaskId: f.task.id },
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_FIELD" });
    await expect(
      s.update(owner, f.task.id, 1, { data: { principles: [] } }),
    ).rejects.toMatchObject({ code: "PROTECTED_FIELD" });
    await expect(
      s.update(agent(), f.check.id, 1, { data: { required: false } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.update(agent(), f.task.id, 1, { data: { template: "standard" } }),
    ).rejects.toMatchObject({ status: 403 });
    const issue = await s.create(owner, {
      kind: "issue",
      taskId: f.task.id,
      title: "Blocking",
      data: { blocking: true },
    });
    await expect(
      s.update(agent(), issue.id, 1, { data: { blocking: false } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.update(agent(), f.criterion.id, 1, {
        data: { applicable: false, exclusionReason: "skip" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("quality, acceptance and audit", () => {
  it("requires owner-confirmed principle evidence bound to the adopted version and code", async () => {
    const f = await readyTask(s);
    const principle = await s.create(owner, {
      kind: "principle",
      taskId: f.task.id,
      title: "Complete search results",
      body: "All matching articles must appear in the results.",
      data: { strength: "required" },
      approve: true,
    });
    await s.adoptPrinciples(owner, f.task.id, 1);
    expect((await s.report(owner, f.task.id)).gaps).toContain(
      "必需原则尚未完成当前代码版本的人工核对",
    );
    await expect(
      s.confirmPrinciple(agent(), f.task.id, 2, principle.id, "review"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.confirmPrinciple(owner, f.task.id, 1, principle.id, "review"),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      s.confirmPrinciple(owner, f.task.id, 2, "unknown", "review"),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(
      s.confirmPrinciple(owner, f.task.id, 2, principle.id, ""),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const task = await s.confirmPrinciple(
      owner,
      f.task.id,
      2,
      principle.id,
      "Reviewed search behavior and CI evidence",
      "confirm",
    );
    expect(task.version).toBe(3);
    expect((await s.report(owner, task.id)).gaps).toEqual([]);
    await s.update(owner, task.id, 3, { data: { codeRef: "b".repeat(40) } });
    expect((await s.report(owner, task.id)).gaps).toContain(
      "必需原则尚未完成当前代码版本的人工核对",
    );
    await expect(
      s.update(owner, task.id, 4, { data: { principleChecks: [] } }),
    ).rejects.toMatchObject({ code: "PROTECTED_FIELD" });
    await s.confirmPrinciple(
      owner,
      task.id,
      4,
      principle.id,
      "Rechecked new code",
    );
    expect((await s.get(task.id)).data.principleChecks).toHaveLength(1);
  });
  it("uses the approved principle scope and strength even while edits await review", async () => {
    const f = await readyTask(s);
    const p = await s.create(owner, {
      kind: "principle",
      taskId: f.task.id,
      title: "Required global principle",
      data: { strength: "required" },
      approve: true,
    });
    await s.update(owner, p.id, 1, { data: { strength: "recommended" } });
    const adopted = await s.adoptPrinciples(owner, f.task.id, 1);
    expect(adopted.data.principles?.[0]).toMatchObject({
      id: p.id,
      version: 1,
      strength: "required",
    });
    await s.approve(owner, p.id, 2);
    await s.adoptPrinciples(owner, f.task.id, 2);
    expect((await s.get(f.task.id)).data.principles?.[0].strength).toBe(
      "recommended",
    );
  });
  it("makes evidence immutable and rejects stale check/criterion snapshots", async () => {
    const f = await readyTask(s);
    await expect(
      s.update(owner, f.result.id, 1, { title: "Rewritten pass" }),
    ).rejects.toMatchObject({ code: "IMMUTABLE" });
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: { ...f.resultInput.data, checkId: f.requirement.id },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: { ...f.resultInput.data, checkVersion: 9 },
      }),
    ).rejects.toMatchObject({ code: "STALE_CHECK" });
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: {
          ...f.resultInput.data,
          criterionVersions: { [f.criterion.id]: 2 },
        },
      }),
    ).rejects.toMatchObject({ code: "STALE_CRITERION" });
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: {
          ...f.resultInput.data,
          criterionVersions: { [f.criterion.id]: 1, extra: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await s.update(owner, f.task.id, 1, { data: { codeRef: "b".repeat(40) } });
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("stale");
  });
  it("accepts only after deterministic gates pass, freezes the snapshot and allows owner reopening", async () => {
    const f = await readyTask(s);
    await expect(s.accept(agent(), f.task.id, 1)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.accept(owner, f.task.id, 2)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    const done = await s.accept(owner, f.task.id, 1, "accept");
    expect(done.status).toBe("done");
    expect((await db.query("SELECT * FROM reports")).rows).toHaveLength(1);
    await expect(
      s.create(owner, { kind: "issue", title: "Late", taskId: f.task.id }),
    ).rejects.toMatchObject({ code: "TASK_CLOSED" });
    await expect(
      s.update(owner, f.task.id, 2, { title: "Late" }),
    ).rejects.toMatchObject({ code: "TASK_CLOSED" });
    await expect(s.approve(owner, f.check.id, 1)).rejects.toMatchObject({
      code: "TASK_CLOSED",
    });
    await expect(s.accept(owner, f.task.id, 2)).rejects.toMatchObject({
      code: "TASK_CLOSED",
    });
    await s.changeStatus(owner, f.task.id, 2, "active");
    await s.update(owner, f.task.id, 3, { data: { codeRef: "b".repeat(40) } });
    const saved = (await db.query<{ data: any }>("SELECT data FROM reports"))
      .rows[0].data;
    expect(saved.rows[0].state).toBe("passed");
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("stale");
  });
  it("blocks failed current runs and unmet work, then permits explicit owner waivers", async () => {
    const f = await readyTask(s);
    await s.create(owner, {
      ...f.resultInput,
      data: { ...f.resultInput.data, outcome: "failed" },
    });
    await expect(s.accept(owner, f.task.id, 1)).rejects.toMatchObject({
      code: "ACCEPTANCE_BLOCKED",
    });
    await expect(s.waive(owner, f.criterion.id, 1, " ")).rejects.toThrow();
    await expect(
      s.waive(owner, f.criterion.id, 2, "Known risk"),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await s.waive(owner, f.criterion.id, 1, "Accepted with manual mitigation");
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("waived");
    await s.update(owner, f.criterion.id, 1, { body: "Changed semantics" });
    expect((await s.get(f.criterion.id)).data.waiver).toBeUndefined();
  });
  it("supports valid status transitions without bypassing final acceptance", async () => {
    const f = await readyTask(s);
    const w = await s.create(owner, {
      kind: "work_item",
      taskId: f.task.id,
      title: "Build",
    });
    await expect(s.changeStatus(owner, w.id, 2, "done")).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      s.changeStatus(agent(), w.id, 1, "cancelled"),
    ).rejects.toMatchObject({ status: 403 });
    await s.changeStatus(agent(), w.id, 1, "doing");
    await s.changeStatus(agent(), w.id, 2, "done");
    await expect(
      s.changeStatus(owner, f.task.id, 1, "done"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await s.accept(owner, f.task.id, 1);
    await expect(s.changeStatus(owner, w.id, 3, "doing")).rejects.toMatchObject(
      { code: "TASK_CLOSED" },
    );
  });
  it("preserves references when archiving and enforces owner control", async () => {
    const f = await readyTask(s);
    await expect(s.archive(agent(), f.check.id, 1)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.archive(owner, f.task.id, 1)).rejects.toMatchObject({
      code: "INVALID_ARCHIVE",
    });
    await expect(s.archive(owner, f.requirement.id, 1)).rejects.toMatchObject({
      code: "INVALID_ARCHIVE",
    });
    const todo = await s.create(owner, { kind: "todo", title: "Discard" });
    await expect(s.archive(owner, todo.id, 9)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect((await s.archive(owner, todo.id, 1)).status).toBe("archived");
  });
  it("converts an idea exactly once and retains a source link", async () => {
    const project = await s.create(owner, {
      kind: "project",
      title: "Project",
    });
    const todo = await s.create(owner, {
      kind: "todo",
      title: "New idea",
      body: "Do this",
    });
    const task = await s.convertTodo(owner, todo.id, 1, project.id, "convert");
    expect(
      (await s.convertTodo(owner, todo.id, 1, project.id, "convert")).id,
    ).toBe(task.id);
    expect((await s.get(todo.id)).data.targetTaskId).toBe(task.id);
    await expect(
      s.convertTodo(owner, todo.id, 2, project.id),
    ).rejects.toMatchObject({ code: "ALREADY_CONVERTED" });
    await expect(
      s.convertTodo(owner, project.id, 1, project.id),
    ).rejects.toMatchObject({ code: "INVALID_KIND" });
  });
  it("pins adopted principle versions and exposes updates until explicitly adopted", async () => {
    const f = await readyTask(s);
    const p = await s.create(owner, {
      kind: "principle",
      taskId: f.task.id,
      title: "Stable APIs",
      body: "v1",
      approve: true,
    });
    await s.adoptPrinciples(owner, f.task.id, 1);
    await s.update(owner, p.id, 1, { body: "v2" });
    await s.approve(owner, p.id, 2);
    const before = await s.context(owner, f.task.id);
    expect(before.principles?.[0].body).toBe("v1");
    expect(before.availablePrincipleUpdates?.[0].version).toBe(2);
    await s.adoptPrinciples(owner, f.task.id, 2);
    expect((await s.context(owner, f.task.id)).principles?.[0].body).toBe("v2");
    await expect(s.adoptPrinciples(owner, f.task.id, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
  it("saves immutable reports, paginates events by cursor, and filters unauthorized events", async () => {
    const f = await readyTask(s);
    const snapshot = await s.saveReport(owner, f.task.id, "report");
    expect(snapshot.metrics.passed).toBe(1);
    await expect(
      s.saveReport(agent(["*"], ["read"]), f.task.id),
    ).rejects.toMatchObject({ status: 403 });
    const all = await s.events(owner);
    expect(all.items).toHaveLength(6);
    expect((await s.events(owner, Number(all.cursor))).items).toEqual([]);
    expect((await s.events(agent(["other"]))).items).toEqual([]);
    expect((await s.events(agent([f.task.id]))).items).toHaveLength(5);
  });
  it("coalesces automatic summaries into a durable job after task mutations", async () => {
    await db.query("INSERT INTO settings(key,value) VALUES('llm',$1)", [
      JSON.stringify({ autoSummary: true }),
    ]);
    const f = await readyTask(s);
    const jobs = (
      await db.query<{ generation: number; task_id: string }>(
        "SELECT * FROM assistant_runs",
      )
    ).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].generation).toBe(4);
    expect(jobs[0].task_id).toBe(f.task.id);
  });
});
