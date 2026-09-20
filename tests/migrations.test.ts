import { it, expect } from "vitest";
import { openDatabase } from "../server/db";
import { Service, owner } from "../server/service";
import { migrateTaskPrinciples } from "../server/migrations";
import { readyTask, agent } from "./fixtures";
import type { Data, Entity } from "../shared/domain";

it("migrates legacy principles transactionally, preserving adopted historical versions and task isolation across restarts", async () => {
  const db = await openDatabase(),
    s = new Service(db);
  try {
    const a = await readyTask(s),
      b = await readyTask(s);
    const local = await s.create(owner, {
      kind: "principle",
      title: "Task only",
      taskId: a.task.id,
      approve: true,
    });
    const global = await s.create(owner, {
      kind: "principle",
      title: "Global v1",
      taskId: a.task.id,
      data: { strength: "required" },
      approve: true,
    });
    await s.adoptPrinciples(owner, a.task.id, 1);
    await s.confirmPrinciple(
      owner,
      a.task.id,
      2,
      global.id,
      "Reviewed against code",
    );
    await s.update(owner, global.id, 1, {
      title: "Global pending v2",
      data: { strength: "recommended" },
    });
    const project = await s.create(owner, {
      kind: "principle",
      title: "Project",
      taskId: a.task.id,
      approve: true,
    });
    const draft = await s.create(owner, {
      kind: "principle",
      title: "Draft",
      taskId: a.task.id,
    });
    const retired = await s.create(owner, {
      kind: "principle",
      title: "Retired",
      taskId: a.task.id,
      approve: true,
    });
    await s.archive(owner, retired.id, 1);
    const adoptedRetired = await s.create(owner, {
      kind: "principle",
      title: "Old baseline",
      taskId: a.task.id,
      approve: true,
    });
    await db.query(
      "UPDATE records SET data=jsonb_set(data,'{principles}', $2::jsonb) WHERE id=$1",
      [
        b.task.id,
        JSON.stringify([
          { id: adoptedRetired.id, version: 1, strength: "recommended" },
        ]),
      ],
    );
    await s.archive(owner, adoptedRetired.id, 1);
    const beforeReport = await s.saveReport(owner, a.task.id);
    async function legacy(
      p: Entity,
      scope: Data["scope"],
      projectId: string | null,
    ) {
      const current = await s.get(p.id);
      await db.query(
        "UPDATE records SET task_id=NULL,project_id=$2,data=$3 WHERE id=$1",
        [p.id, projectId, JSON.stringify({ ...current.data, scope })],
      );
      for (const rev of (await s.history(owner, p.id)) as {
        snapshot: Entity;
        version: number;
      }[])
        await db.query(
          "UPDATE revisions SET snapshot=$3 WHERE record_id=$1 AND version=$2",
          [
            p.id,
            rev.version,
            JSON.stringify({
              ...rev.snapshot,
              taskId: null,
              projectId,
              data: { ...rev.snapshot.data, scope },
            }),
          ],
        );
    }
    await legacy(global, "global", null);
    await legacy(project, "project", a.project.id);
    await legacy(draft, "global", null);
    await legacy(retired, "global", null);
    await legacy(adoptedRetired, "global", null);
    // Closed tasks also retain their original adoption history during migration.
    await db.query("UPDATE records SET status='done' WHERE id=$1", [a.task.id]);
    await migrateTaskPrinciples(db);
    const all = await s.all(),
      copies = all.filter((p) => p.kind === "principle" && p.taskId);
    expect(copies.filter((p) => p.title === "Global pending v2")).toHaveLength(
      2,
    );
    expect(copies.filter((p) => p.title === "Project")).toHaveLength(1);
    expect(copies.filter((p) => p.title === "Retired")).toHaveLength(0);
    expect(copies.filter((p) => p.title === "Old baseline")).toHaveLength(1);
    expect(copies.find((p) => p.title === "Old baseline")?.taskId).toBe(
      b.task.id,
    );
    expect(
      copies
        .filter((p) => p.title === "Draft")
        .every((p) => p.approvedVersion === null),
    ).toBe(true);
    expect((await s.get(local.id)).version).toBe(1);
    const task = await s.get(a.task.id),
      ref = task.data.principles?.find((p) => p.id !== local.id)!;
    expect(task.status).toBe("done");
    expect(ref.version).toBe(1);
    expect(ref.id).not.toBe(global.id);
    expect(task.data.principleChecks?.[0]).toMatchObject({
      id: ref.id,
      version: 1,
      note: "Reviewed against code",
    });
    const current = await s.get(ref.id);
    expect(current).toMatchObject({
      version: 2,
      approvedVersion: 1,
      data: { scope: "task", strength: "recommended" },
    });
    const context = await s.context(owner, task.id);
    expect(context.principles?.find((p) => p.id === ref.id)).toMatchObject({
      title: "Global v1",
      data: { scope: "task", strength: "required" },
    });
    expect(await s.history(owner, ref.id)).toHaveLength(2);
    expect((await s.get(global.id)).status).toBe("archived");
    expect(await s.history(owner, global.id)).toHaveLength(3);
    await expect(s.read(agent([b.task.id]), ref.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (
        await db.query<{ data: any }>("SELECT data FROM reports WHERE id=$1", [
          beforeReport.id,
        ])
      ).rows[0].data.task.data.principles,
    ).toEqual(beforeReport.task.data.principles);
    const total = all.length,
      eventCount = (await s.events(owner)).items.length;
    await migrateTaskPrinciples(db);
    expect(await s.all()).toHaveLength(total);
    expect((await s.events(owner)).items).toHaveLength(eventCount);
    expect(new Set((await s.all()).map((r) => r.key)).size).toBe(total);
  } finally {
    await db.close();
  }
});

it("preserves legacy originals with no applicable tasks and safely migrates tasks without adopted references", async () => {
  const db = await openDatabase(),
    s = new Service(db);
  try {
    const f = await readyTask(s),
      p = await s.create(owner, {
        kind: "principle",
        title: "Global",
        taskId: f.task.id,
        approve: true,
      });
    await db.query(
      "UPDATE records SET task_id=NULL,project_id=NULL,data='{" +
        '"scope":"global"' +
        "}' WHERE id=$1",
      [p.id],
    );
    await db.query("UPDATE records SET data=data-'principles' WHERE id=$1", [
      f.task.id,
    ]);
    const retired = await s.create(owner, {
      kind: "principle",
      title: "Unadopted old principle",
      taskId: f.task.id,
    });
    await db.query(
      "UPDATE records SET task_id=NULL,project_id=NULL,status='archived' WHERE id=$1",
      [retired.id],
    );
    await migrateTaskPrinciples(db);
    expect(
      (await s.all()).filter(
        (p) => p.kind === "principle" && p.taskId === f.task.id,
      ),
    ).toHaveLength(1);
    expect((await s.get(f.task.id)).data.principles).toBeUndefined();
    expect((await s.get(retired.id)).status).toBe("archived");
  } finally {
    await db.close();
  }
});
