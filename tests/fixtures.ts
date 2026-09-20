import { Service, owner } from "../server/service";
import type { Database } from "../server/db";
import type { Entity, Kind, Actor } from "../shared/domain";

export const sha = "a".repeat(40);
export function record(kind: Kind, patch: Partial<Entity> = {}): Entity {
  return {
    id: kind,
    key: kind.toUpperCase() + "-001",
    kind,
    title: kind,
    body: "",
    taskId: kind === "task" ? null : "task",
    projectId: "project",
    status: "draft",
    version: 1,
    approvedVersion: 1,
    data: {},
    sequence: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}
export const agent = (
  taskIds = ["*"],
  permissions = ["read", "write"],
): Actor => ({
  id: "agent",
  name: "Test agent",
  role: "agent",
  taskIds,
  permissions,
});
export async function clear(db: Database) {
  await db.query(
    "TRUNCATE records, revisions, events, reviews, users, sessions, tokens, settings, idempotency, reports, assistant_runs, oauth_clients, oauth_codes, oauth_refresh RESTART IDENTITY CASCADE",
  );
}
export async function readyTask(s: Service) {
  const project = await s.create(owner, {
    kind: "project",
    title: "Knowledge base",
  });
  const task = await s.create(owner, {
    kind: "task",
    title: "Article search",
    projectId: project.id,
    data: { codeRef: sha },
  });
  const requirement = await s.create(owner, {
    kind: "requirement",
    taskId: task.id,
    title: "Find relevant articles",
    approve: true,
  });
  const criterion = await s.create(owner, {
    kind: "criterion",
    taskId: task.id,
    title: "Matching articles appear once",
    data: { requirementId: requirement.id },
    approve: true,
  });
  const check = await s.create(owner, {
    kind: "check",
    taskId: task.id,
    title: "Search results",
    data: { criterionIds: [criterion.id] },
    approve: true,
  });
  const resultInput = {
    kind: "result",
    taskId: task.id,
    title: "CI run",
    data: {
      checkId: check.id,
      checkVersion: check.version,
      criterionVersions: { [criterion.id]: criterion.version },
      requirementVersions: { [requirement.id]: requirement.version },
      codeRef: sha,
      outcome: "passed",
      evidence: "https://ci.example/run/1",
      environment: "Node 22 / Linux",
    },
  };
  const result = await s.create(owner, resultInput);
  return { project, task, requirement, criterion, check, result, resultInput };
}
