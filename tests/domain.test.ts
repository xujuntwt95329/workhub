import { describe, it, expect } from "vitest";
import {
  parseInput,
  canRead,
  authorize,
  assertTransition,
  evaluateMatrix,
  coverage,
  completionGaps,
  applicablePrinciples,
  csvCell,
  reportCsv,
  DomainError,
  ensure,
  kinds,
  availableTransitions,
} from "../shared/domain";
import { owner } from "../server/service";
import { record, agent, sha } from "./fixtures";

function matrixFixture() {
  const task = record("task", { data: { codeRef: sha, template: "light" } });
  const req = record("requirement");
  const ac = record("criterion", { data: { requirementId: req.id } });
  const check = record("check", {
    data: { criterionIds: [ac.id], required: true },
  });
  const run = record("result", {
    data: {
      checkId: check.id,
      checkVersion: 1,
      criterionVersions: { [ac.id]: 1 },
      requirementVersions: { [req.id]: 1 },
      codeRef: sha,
      outcome: "passed",
      evidence: "CI",
      environment: "test",
    },
    sequence: 2,
  });
  return { task, req, ac, check, run, all: [req, ac, check, run] };
}
describe("input contracts", () => {
  it.each(kinds)("validates %s defaults", (kind) => {
    const data =
      kind === "criterion"
        ? { requirementId: "r" }
        : kind === "check"
          ? { criterionIds: ["c"] }
          : kind === "result"
            ? {
                checkId: "q",
                checkVersion: 1,
                criterionVersions: { c: 1 },
                requirementVersions: { r: 1 },
                codeRef: sha,
                outcome: "passed",
                evidence: "logs",
                environment: "CI",
              }
            : {};
    expect(parseInput({ kind, title: "  title  ", data })).toMatchObject({
      kind,
      title: "title",
      body: "",
      approve: false,
    });
  });
  it.each([
    { kind: "task", title: "" },
    { kind: "task", title: "x", status: "done" },
    { kind: "task", title: "x", data: { codeRef: "HEAD" } },
    { kind: "result", title: "x", data: {} },
    {
      kind: "criterion",
      title: "x",
      data: { requirementId: "r", applicable: false },
    },
    { kind: "task", title: "x", data: { injected: "yes" } },
  ])("rejects malformed or protected contracts %#", (input) =>
    expect(() => parseInput(input)).toThrow(),
  );
  it("requires a reason for a not-applicable criterion", () =>
    expect(
      parseInput({
        kind: "criterion",
        title: "x",
        data: {
          requirementId: "r",
          applicable: false,
          exclusionReason: "No Windows support",
        },
      }).data.applicable,
    ).toBe(false));
  it("keeps structured domain errors", () => {
    expect(() => ensure(false, "TEST", "no", 409)).toThrow(DomainError);
    ensure(true, "OK", "ok");
  });
});
describe("capabilities and workflow", () => {
  it("offers only transitions valid for the current state", () => {
    expect(availableTransitions(record("task", { status: "blocked" }))).toEqual(
      ["active", "cancelled"],
    );
    expect(availableTransitions(record("result"))).toEqual([]);
  });
  it("limits task agents, while allowing linked ideas", () => {
    expect(canRead(agent(["task"]), record("task"))).toBe(true);
    expect(canRead(agent(["other"]), record("requirement"))).toBe(false);
    expect(
      canRead(
        agent(["task"]),
        record("todo", { taskId: null, data: { targetTaskId: "task" } }),
      ),
    ).toBe(true);
    expect(canRead(agent(["task"]), record("project", { taskId: null }))).toBe(
      false,
    );
    expect(canRead(owner, record("project"))).toBe(true);
  });
  it.each(["approve", "accept", "waive", "configure", "publish", "restore"])(
    "prevents an agent from %s even with a forged permission",
    (action) =>
      expect(() => authorize(agent(["*"], [action]), action)).toThrow("Owner"),
  );
  it("checks both permissions and scope", () => {
    expect(() => authorize(agent(["task"], ["read"]), "write")).toThrow();
    expect(() =>
      authorize(agent(["other"]), "write", record("task")),
    ).toThrow();
    authorize(owner, "anything");
    authorize(agent(), "read", record("task"));
  });
  it("forbids direct completion and owner-only gate changes", () => {
    expect(() =>
      assertTransition(record("task", { status: "active" }), "done", owner),
    ).toThrow();
    expect(() =>
      assertTransition(
        record("work_item", { status: "doing", data: { required: true } }),
        "cancelled",
        agent(),
      ),
    ).toThrow();
    expect(() =>
      assertTransition(
        record("question", { status: "open" }),
        "resolved",
        agent(),
      ),
    ).toThrow();
    expect(() =>
      assertTransition(record("task", { status: "done" }), "active", agent()),
    ).toThrow();
    assertTransition(record("task", { status: "done" }), "active", owner);
    assertTransition(
      record("work_item", { status: "doing", data: { required: false } }),
      "cancelled",
      agent(),
    );
  });
});
describe("deterministic coverage and evidence validity", () => {
  it("computes full coverage only with current evidence", () => {
    const f = matrixFixture();
    const rows = evaluateMatrix(f.task, f.all);
    expect(rows[0].state).toBe("passed");
    expect(coverage(rows)).toMatchObject({
      total: 1,
      passed: 1,
      executed: 1,
      linked: 1,
      passRate: 1,
    });
    expect(completionGaps(f.task, f.all)).toEqual([]);
  });
  it.each(["failed", "blocked", "error", "skipped"] as const)(
    "does not count %s as passed",
    (outcome) => {
      const f = matrixFixture();
      f.run.data.outcome = outcome;
      const rows = evaluateMatrix(f.task, f.all);
      expect(rows[0].state).toBe(outcome);
      expect(coverage(rows).passed).toBe(0);
    },
  );
  it.each(["code", "check", "criterion", "emptyCode"])(
    "invalidates evidence when %s changes",
    (change) => {
      const f = matrixFixture();
      if (change === "code") f.task.data.codeRef = "b".repeat(40);
      if (change === "check") f.check.version++;
      if (change === "criterion") f.ac.version++;
      if (change === "emptyCode") f.task.data.codeRef = "";
      expect(evaluateMatrix(f.task, f.all)[0].state).toBe("stale");
    },
  );
  it("uses the last server-sequenced run and cannot revive an earlier pass", () => {
    const f = matrixFixture();
    const failure = {
      ...f.run,
      id: "later",
      sequence: 3,
      data: { ...f.run.data, outcome: "failed" },
    };
    expect(evaluateMatrix(f.task, [failure, ...f.all])[0].state).toBe("failed");
  });
  it("ignores archived and other-task records", () => {
    const f = matrixFixture();
    f.run.status = "archived";
    const alien = {
      ...f.run,
      id: "alien",
      taskId: "other",
      status: "recorded",
      sequence: 99,
    };
    expect(evaluateMatrix(f.task, [...f.all, alien])[0].state).toBe("missing");
  });
  it("requires every required check but ignores optional failures", () => {
    const f = matrixFixture();
    const c = {
      ...f.check,
      id: "optional",
      data: { ...f.check.data, required: false },
    };
    const r = {
      ...f.run,
      id: "fail",
      data: { ...f.run.data, checkId: c.id, outcome: "failed" },
    };
    expect(evaluateMatrix(f.task, [...f.all, c, r])[0].state).toBe("passed");
    c.data.required = true;
    expect(evaluateMatrix(f.task, [...f.all, c, r])[0].state).toBe("failed");
  });
  it("does not mistake zero required checks for a pass", () => {
    const f = matrixFixture();
    f.check.data.required = false;
    expect(evaluateMatrix(f.task, f.all)[0].state).toBe("missing");
    expect(coverage([])).toMatchObject({
      total: 0,
      passRate: null,
      linkRate: null,
      executionRate: null,
    });
  });
  it("distinguishes approved exclusions and version-bound waivers", () => {
    const f = matrixFixture();
    f.ac.data.applicable = false;
    f.ac.approvedVersion = null;
    expect(evaluateMatrix(f.task, f.all)[0].state).toBe("passed");
    f.ac.approvedVersion = 1;
    expect(coverage(evaluateMatrix(f.task, f.all))).toMatchObject({
      total: 0,
      notApplicable: 1,
    });
    f.ac.data.applicable = true;
    f.ac.data.waiver = {
      reason: "Accepted risk",
      version: 1,
      codeRef: sha,
      requirementVersion: 1,
    };
    expect(coverage(evaluateMatrix(f.task, [f.req, f.ac]))).toMatchObject({
      waived: 1,
      passed: 0,
      passRate: 0,
    });
    f.ac.version++;
    expect(evaluateMatrix(f.task, [f.req, f.ac])[0].state).toBe("missing");
  });
  it("reports all completion gaps, including review, design, work and blockers", () => {
    const f = matrixFixture();
    f.task.data = { template: "standard" };
    f.ac.approvedVersion = null;
    const items = [
      f.req,
      f.ac,
      record("requirement", { id: "empty" }),
      record("design", { approvedVersion: null, data: { required: true } }),
      record("work_item"),
      record("issue", { status: "resolved", data: { blocking: true } }),
      record("question", { status: "open", data: { blocking: true } }),
    ];
    const gaps = completionGaps(f.task, items);
    expect(gaps).toHaveLength(8);
    expect(completionGaps(f.task, [])).toHaveLength(4);
  });
  it("resolves principle scopes and ignores drafts or retired principles", () => {
    const t = record("task");
    const ps = [
      record("principle", {
        id: "g",
        taskId: null,
        status: "active",
        data: { scope: "global" },
      }),
      record("principle", {
        id: "p",
        taskId: null,
        status: "active",
        data: { scope: "project" },
      }),
      record("principle", {
        id: "t",
        status: "active",
        data: { scope: "task" },
      }),
      record("principle", {
        id: "x",
        projectId: "other",
        taskId: "other",
        status: "active",
        data: { scope: "project" },
      }),
      record("principle", { id: "draft", data: { scope: "global" } }),
    ];
    expect(applicablePrinciples(t, ps).map((p) => p.id)).toEqual(["t"]);
  });
  it("escapes CSV quotes, formula injection and empty values", () => {
    expect(csvCell(' =HYPERLINK("evil")')).toBe('"\' =HYPERLINK(""evil"")"');
    expect(csvCell(null)).toBe('""');
    const f = matrixFixture();
    const csv = reportCsv(evaluateMatrix(f.task, f.all));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("passed");
    expect(
      reportCsv([{ criterion: f.ac, checks: [], state: "missing" }]),
    ).toContain("missing");
  });
});
