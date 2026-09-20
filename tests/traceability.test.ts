import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { openDatabase, type Database } from "../server/db";
import { Service, owner } from "../server/service";
import { traceability } from "../shared/traceability";
import { completionGaps, evidenceState, parseInput } from "../shared/domain";
import { clear, readyTask, agent, record, sha } from "./fixtures";
let db: Database, s: Service;
beforeAll(async () => {
  db = await openDatabase();
  s = new Service(db);
});
beforeEach(() => clear(db));
afterAll(() => db.close());
describe("requirement lifecycle and stable traceability", () => {
  it("invalidates manual waivers when their requirement changes and rejects waivers outside current scope", async () => {
    const f = await readyTask(s);
    await s.waive(owner, f.criterion.id, 1, "Accepted risk");
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("waived");
    await s.update(owner, f.requirement.id, 1, { body: "New scope" });
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("stale");
    await s.disposeRequirement(owner, f.requirement.id, 2, "reject", "Later");
    await expect(
      s.waive(owner, f.criterion.id, 1, "Skip"),
    ).rejects.toMatchObject({ code: "INACTIVE_REQUIREMENT" });
  });
  it("rejects, deletes and restores without destroying criteria, case links, evidence or audit history", async () => {
    const f = await readyTask(s);
    await s.requestReview(agent(), f.requirement.id, 1);
    const rejected = await s.disposeRequirement(
      owner,
      f.requirement.id,
      1,
      "reject",
      "Outside this iteration",
      "reject-1",
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      version: 2,
      approvedVersion: null,
      data: {
        disposition: {
          reason: "Outside this iteration",
          previousStatus: "draft",
        },
      },
    });
    expect(
      await s.disposeRequirement(
        owner,
        f.requirement.id,
        1,
        "reject",
        "Outside this iteration",
        "reject-1",
      ),
    ).toEqual(rejected);
    let report = await s.report(owner, f.task.id);
    expect(report.rows).toEqual([]);
    expect(report.traceability.cases[0].state).toBe("out_of_scope");
    expect(report.traceability.excludedRequirements[0].id).toBe(
      f.requirement.id,
    );
    expect(report.gaps).not.toContain("需求、验收标准或检查仍有未确认版本");
    const context = await s.context(agent([f.task.id]), f.task.id);
    expect(context.records.map((r) => r.id)).not.toContain(f.criterion.id);
    expect(context.records.map((r) => r.id)).not.toContain(f.check.id);
    expect(context.excludedRequirements?.[0].id).toBe(f.requirement.id);
    expect((await s.context(owner)).records.map((r) => r.id)).not.toContain(
      f.criterion.id,
    );
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM reviews WHERE record_id=$1",
          [f.requirement.id],
        )
      ).rows[0].status,
    ).toBe("superseded");
    const deleted = await s.disposeRequirement(
      owner,
      f.requirement.id,
      2,
      "delete",
      "Remove from backlog",
    );
    expect(deleted.status).toBe("deleted");
    const restored = await s.disposeRequirement(
      owner,
      f.requirement.id,
      3,
      "restore",
      "Reconsidered",
    );
    expect(restored.status).toBe("draft");
    expect(restored.approvedVersion).toBeNull();
    await s.approve(owner, restored.id, 4);
    report = await s.report(owner, f.task.id);
    expect(report.rows[0].state).toBe("stale");
    const result = await s.create(owner, {
      ...f.resultInput,
      data: {
        ...f.resultInput.data,
        requirementVersions: { [restored.id]: 4 },
      },
    });
    expect((await s.report(owner, f.task.id)).rows[0].state).toBe("passed");
    expect(
      (await s.history(owner, restored.id)).map((r: any) => r.version),
    ).toEqual([4, 3, 2, 1]);
    expect((await s.get(f.result.id)).data.requirementVersions).toEqual({
      [restored.id]: 1,
    });
    expect(result.data.requirementVersions).toEqual({ [restored.id]: 4 });
  });
  it("enforces owner, optimistic versions, valid states, reasons, and closed-task guards", async () => {
    const f = await readyTask(s);
    await expect(
      s.disposeRequirement(agent(), f.requirement.id, 1, "reject", "x"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.disposeRequirement(owner, f.task.id, 1, "delete", "x"),
    ).rejects.toMatchObject({ code: "INVALID_KIND" });
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 2, "reject", "x"),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 1, "reject", " "),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 1, "restore", ""),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      s.changeStatus(owner, f.requirement.id, 1, "rejected"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await s.disposeRequirement(owner, f.requirement.id, 1, "reject", "x");
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 2, "reject", "x"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    for (const r of [await s.get(f.requirement.id), f.criterion]) {
      await expect(
        s.update(owner, r.id, r.version, { body: "changed" }),
      ).rejects.toThrow();
      await expect(s.approve(owner, r.id, r.version)).rejects.toThrow();
      await expect(s.requestReview(owner, r.id, r.version)).rejects.toThrow();
    }
    await s.disposeRequirement(owner, f.requirement.id, 2, "delete", "x");
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 3, "delete", "x"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await s.changeStatus(owner, f.task.id, 1, "cancelled");
    await expect(
      s.disposeRequirement(owner, f.requirement.id, 3, "restore", ""),
    ).rejects.toMatchObject({ code: "TASK_CLOSED" });
  });
  it("validates group ownership, prevents spoofed disposition, and preserves referenced groups", async () => {
    const f = await readyTask(s),
      other = await readyTask(s);
    const group = await s.create(agent([f.task.id]), {
      kind: "requirement_group",
      title: "Scheduling",
      taskId: f.task.id,
      data: { order: 10 },
    });
    await s.update(owner, f.requirement.id, 1, { data: { groupId: group.id } });
    await expect(s.archive(owner, group.id, 1)).rejects.toMatchObject({
      code: "REFERENCED",
    });
    await expect(
      s.update(owner, other.requirement.id, 1, { data: { groupId: group.id } }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(
      s.update(owner, f.requirement.id, 2, { data: { groupId: f.check.id } }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(
      s.create(owner, {
        kind: "requirement",
        title: "spoof",
        taskId: f.task.id,
        data: {
          disposition: {
            reason: "fake",
            actorId: "x",
            at: "x",
            previousStatus: "draft",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_FIELD" });
    await expect(
      s.update(owner, f.requirement.id, 2, {
        data: {
          disposition: {
            reason: "fake",
            actorId: "x",
            at: "x",
            previousStatus: "draft",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_FIELD" });
    await s.update(owner, f.requirement.id, 2, { data: { groupId: null } });
    await s.archive(owner, group.id, 1);
    await expect(
      s.update(owner, f.requirement.id, 3, { data: { groupId: group.id } }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
  });
  it("invalidates old evidence on requirement edits and validates the complete version map", async () => {
    const f = await readyTask(s);
    await s.update(owner, f.requirement.id, 1, { body: "Updated semantics" });
    await expect(s.create(owner, f.resultInput)).rejects.toMatchObject({
      code: "STALE_REQUIREMENT",
    });
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: {
          ...f.resultInput.data,
          requirementVersions: { [f.requirement.id]: 2, other: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    const report = await s.report(owner, f.task.id);
    expect(report.traceability.gaps.staleCases[0].id).toBe(f.check.id);
    expect(() =>
      parseInput({
        ...f.resultInput,
        data: { ...f.resultInput.data, requirementVersions: undefined },
      }),
    ).toThrow();
    expect(
      evidenceState(f.task, f.check, f.criterion, f.requirement, {
        ...f.result,
        data: { ...f.result.data, requirementVersions: undefined },
      }),
    ).toBe("stale");
    const orphan = await s.create(owner, {
      kind: "check",
      title: "Unlinked",
      taskId: f.task.id,
      approve: true,
    });
    expect((await s.report(owner, f.task.id)).gaps).toContain(
      "必需测试用例尚未关联验收标准",
    );
    await s.archive(owner, orphan.id, 1);
    await expect(
      s.create(owner, {
        ...f.resultInput,
        data: {
          ...f.resultInput.data,
          checkId: orphan.id,
          checkVersion: 2,
          criterionVersions: {},
          requirementVersions: {},
        },
      }),
    ).rejects.toMatchObject({ code: "INACTIVE_CASE" });
  });
  it("links defects to same-task cases and maintains mixed active and rejected criterion coverage", async () => {
    const f = await readyTask(s),
      other = await readyTask(s);
    await expect(
      s.create(owner, {
        kind: "issue",
        title: "Wrong task",
        taskId: f.task.id,
        data: { checkIds: [other.check.id] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LINK" });
    const issue = await s.create(owner, {
      kind: "issue",
      title: "Failure",
      taskId: f.task.id,
      data: { checkIds: [f.check.id] },
    });
    expect(
      (await s.report(owner, f.task.id)).traceability.cases[0].issues[0].id,
    ).toBe(issue.id);
    const req = await s.create(owner, {
      kind: "requirement",
      title: "Second scope",
      taskId: f.task.id,
      approve: true,
    });
    const ac = await s.create(owner, {
      kind: "criterion",
      title: "Second criterion",
      taskId: f.task.id,
      data: { requirementId: req.id },
      approve: true,
    });
    const check = await s.update(owner, f.check.id, 1, {
      data: { criterionIds: [f.criterion.id, ac.id] },
    });
    await s.approve(owner, check.id, 2);
    await s.disposeRequirement(owner, req.id, 1, "delete", "Not needed");
    const result = await s.create(owner, {
      ...f.resultInput,
      data: {
        ...f.resultInput.data,
        checkVersion: 2,
        criterionVersions: { [f.criterion.id]: 1, [ac.id]: 1 },
        requirementVersions: { [f.requirement.id]: 1, [req.id]: 2 },
      },
    });
    const report = await s.report(owner, f.task.id);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].state).toBe("passed");
    expect(report.traceability.cases[0].links.map((l) => l.active)).toEqual([
      true,
      false,
    ]);
    expect(report.traceability.cases[0].latestResult?.id).toBe(result.id);
  });
});
describe("task-owned todos and principles", () => {
  it("creates task-scoped content and assigns global ideas without broadening agent scope", async () => {
    const f = await readyTask(s),
      other = await readyTask(s);
    const todo = await s.create(owner, { kind: "todo", title: "Global" });
    await expect(
      s.assignTodo(agent([f.task.id]), todo.id, 1, f.task.id),
    ).rejects.toMatchObject({ status: 403 });
    const assigned = await s.assignTodo(owner, todo.id, 1, f.task.id, "assign");
    expect(assigned).toMatchObject({
      taskId: f.task.id,
      projectId: f.project.id,
      version: 2,
    });
    expect(await s.assignTodo(owner, todo.id, 1, f.task.id, "assign")).toEqual(
      assigned,
    );
    expect(
      (await s.context(agent([f.task.id]), f.task.id)).records.some(
        (r) => r.id === todo.id,
      ),
    ).toBe(true);
    await expect(
      s.assignTodo(agent([f.task.id]), todo.id, 2, other.task.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.assignTodo(agent([f.task.id]), todo.id, 2, null),
    ).rejects.toMatchObject({ status: 403 });
    await s.assignTodo(agent([f.task.id]), todo.id, 2, f.task.id);
    await s.assignTodo(owner, todo.id, 3, null);
    const principle = await s.create(owner, {
      kind: "principle",
      title: "Local rule",
      taskId: f.task.id,
      approve: true,
    });
    await s.adoptPrinciples(owner, f.task.id, 1);
    await s.adoptPrinciples(owner, other.task.id, 1);
    expect((await s.get(f.task.id)).data.principles?.[0].id).toBe(principle.id);
    expect((await s.get(other.task.id)).data.principles).toEqual([]);
    await expect(
      s.create(owner, { kind: "principle", title: "No parent" }),
    ).rejects.toMatchObject({ code: "TASK_REQUIRED" });
  });
  it("checks todo kind, version, destination, closed tasks and converted states", async () => {
    const f = await readyTask(s),
      other = await readyTask(s),
      todo = await s.create(owner, { kind: "todo", title: "Plan" });
    await expect(
      s.assignTodo(owner, f.requirement.id, 1, f.task.id),
    ).rejects.toMatchObject({ code: "INVALID_KIND" });
    await expect(
      s.assignTodo(owner, todo.id, 2, f.task.id),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      s.assignTodo(owner, todo.id, 1, f.project.id),
    ).rejects.toMatchObject({ code: "INVALID_KIND" });
    await s.changeStatus(owner, f.task.id, 1, "cancelled");
    await expect(
      s.assignTodo(owner, todo.id, 1, f.task.id),
    ).rejects.toMatchObject({ code: "TASK_CLOSED" });
    await s.assignTodo(owner, todo.id, 1, other.task.id);
    await s.changeStatus(owner, other.task.id, 1, "cancelled");
    await expect(s.assignTodo(owner, todo.id, 2, null)).rejects.toMatchObject({
      code: "TASK_CLOSED",
    });
    const global = await s.create(owner, { kind: "todo", title: "Convert" });
    await s.convertTodo(owner, global.id, 1, f.project.id);
    await expect(s.assignTodo(owner, global.id, 2, null)).rejects.toMatchObject(
      { code: "INVALID_TRANSITION" },
    );
    const archived = await s.create(owner, { kind: "todo", title: "Archive" });
    await s.archive(owner, archived.id, 1);
    await expect(
      s.assignTodo(owner, archived.id, 2, null),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
it("classifies trace gaps, absent links, excluded scopes and latest execution consistently", () => {
  const task = record("task", { data: { codeRef: sha } }),
    req = record("requirement"),
    ac = record("criterion", { data: { requirementId: req.id } }),
    c = record("check", { data: { criterionIds: [ac.id] } });
  const run = record("result", {
    data: {
      checkId: c.id,
      checkVersion: 1,
      criterionVersions: { [ac.id]: 1 },
      requirementVersions: { [req.id]: 1 },
      codeRef: sha,
      outcome: "passed",
    },
    sequence: 1,
  });
  const empty = record("check", { id: "empty" }),
    optional = record("check", {
      id: "optional",
      data: { criterionIds: [ac.id], required: false },
    }),
    orphan = record("criterion", {
      id: "orphan",
      data: { requirementId: "unknown" },
    }),
    orphanCase = record("check", {
      id: "orphan-case",
      data: { criterionIds: ["missing", orphan.id] },
    }),
    noCriteria = record("requirement", { id: "no-criteria" });
  const records = [
    req,
    ac,
    c,
    run,
    empty,
    optional,
    orphan,
    orphanCase,
    noCriteria,
    record("check", { id: "archived", status: "archived" }),
  ];
  let graph = traceability(task, records);
  expect(graph.gaps.unlinkedCases.map((c) => c.id)).toEqual(["empty"]);
  expect(graph.gaps.requirementsWithoutCriteria.map((r) => r.id)).toEqual([
    "no-criteria",
  ]);
  expect(graph.cases.find((t) => t.testCase.id === c.id)?.state).toBe("passed");
  expect(graph.gaps.outOfScopeCases.map((c) => c.id)).toEqual(["orphan-case"]);
  for (const outcome of ["failed", "error", "blocked", "skipped"] as const) {
    run.data.outcome = outcome;
    expect(traceability(task, records).cases[0].state).toBe(outcome);
  }
  const newer = {
    ...run,
    id: "newer",
    sequence: 2,
    data: { ...run.data, outcome: "passed" as const },
  };
  expect(
    traceability(task, [...records, newer]).cases[0].latestResult?.id,
  ).toBe("newer");
  ac.status = "archived";
  expect(traceability(task, records).cases[0].state).toBe("out_of_scope");
  ac.status = "draft";
  c.data.required = false;
  graph = traceability(task, records);
  expect(graph.gaps.uncoveredCriteria.map((c) => c.id)).toEqual([ac.id]);
  ac.data.applicable = false;
  expect(traceability(task, records).gaps.uncoveredCriteria).toEqual([]);
  expect(completionGaps(task, [req, ac, empty])).toContain(
    "必需测试用例尚未关联验收标准",
  );
  expect(evidenceState(task, c, ac, undefined, run)).toBe("stale");
  expect(evidenceState(task, c, ac, req)).toBe("missing");
});
