import {
  type Entity,
  type MatrixState,
  isCurrent,
  evaluateMatrix,
  evidenceState,
  coverage,
} from "./domain";
export type CaseTrace = {
  testCase: Entity;
  links: {
    criterion: Entity;
    requirement?: Entity;
    active: boolean;
    state: MatrixState;
  }[];
  latestResult?: Entity;
  runCount: number;
  issues: Entity[];
  state: MatrixState | "unlinked" | "out_of_scope";
};
export function traceability(task: Entity, records: Entity[]) {
  const local = records.filter((e) => e.taskId === task.id);
  const cases: CaseTrace[] = local
    .filter((e) => e.kind === "check" && isCurrent(e))
    .map((testCase) => {
      const runs = local
        .filter((e) => e.kind === "result" && e.data.checkId === testCase.id)
        .sort((a, b) => b.sequence - a.sequence);
      const latestResult = runs[0];
      const links = (testCase.data.criterionIds ?? [])
        .map((id) => local.find((e) => e.id === id))
        .filter((e): e is Entity => !!e)
        .map((criterion) => {
          const requirement = local.find(
            (e) => e.id === criterion.data.requirementId,
          );
          return {
            criterion,
            requirement,
            active:
              isCurrent(criterion) && !!requirement && isCurrent(requirement),
            state: evidenceState(
              task,
              testCase,
              criterion,
              requirement,
              latestResult,
            ),
          };
        });
      const active = links.filter((l) => l.active);
      const order: MatrixState[] = [
        "failed",
        "error",
        "blocked",
        "stale",
        "missing",
        "skipped",
      ];
      const state: CaseTrace["state"] = !links.length
        ? "unlinked"
        : !active.length
          ? "out_of_scope"
          : (order.find((s) => active.some((l) => l.state === s)) ?? "passed");
      return {
        testCase,
        links,
        latestResult,
        runCount: runs.length,
        issues: local.filter(
          (e) =>
            e.kind === "issue" &&
            isCurrent(e) &&
            e.data.checkIds?.includes(testCase.id),
        ),
        state,
      };
    });
  const rows = evaluateMatrix(task, records);
  const requirements = local.filter((e) => e.kind === "requirement");
  return {
    taskId: task.id,
    cases,
    rows,
    metrics: coverage(rows),
    gaps: {
      requirementsWithoutCriteria: requirements.filter(
        (r) =>
          isCurrent(r) && !rows.some((row) => row.requirement?.id === r.id),
      ),
      uncoveredCriteria: rows
        .filter(
          (r) =>
            r.state !== "not_applicable" &&
            !r.checks.some((c) => c.check.data.required !== false),
        )
        .map((r) => r.criterion),
      unlinkedCases: cases
        .filter((c) => c.state === "unlinked")
        .map((c) => c.testCase),
      staleCases: cases
        .filter((c) => c.state === "stale")
        .map((c) => c.testCase),
      outOfScopeCases: cases
        .filter((c) => c.state === "out_of_scope")
        .map((c) => c.testCase),
    },
    excludedRequirements: requirements.filter((r) => !isCurrent(r)),
    version: 2,
  };
}
