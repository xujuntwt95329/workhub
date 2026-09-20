import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { Service, owner } from "./service.js";
import type { Entity } from "../shared/domain.js";

// Copy historical versions before replacing adopted references. Original records
// remain archived so old reports and audit links continue to resolve.
export async function migrateTaskPrinciples(db: Database) {
  const service = new Service(db);
  await db.transaction(async (tx) => {
    await service.lock(tx);
    if (
      (await tx.query("SELECT version FROM schema_migrations WHERE version=2"))
        .rows.length
    )
      return;
    const all = await service.all(tx),
      legacy = all.filter((p) => p.kind === "principle" && !p.taskId);
    let count = all.filter((p) => p.kind === "principle").length;
    for (const task of all.filter((t) => t.kind === "task")) {
      const replacements = new Map<string, string>();
      for (const p of legacy.filter(
        (p) =>
          task.data.principles?.some((ref) => ref.id === p.id) ||
          (p.status !== "archived" &&
            (p.data.scope === "global" || p.projectId === task.projectId)),
      )) {
        const copy: Entity = {
          ...p,
          id: randomUUID(),
          key: "PRN-" + String(++count).padStart(3, "0"),
          taskId: task.id,
          projectId: task.projectId,
          data: { ...p.data, scope: "task" },
        };
        await tx.query(
          "INSERT INTO records(id,key,kind,task_id,project_id,title,body,status,data,version,approved_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [
            copy.id,
            copy.key,
            copy.kind,
            copy.taskId,
            copy.projectId,
            copy.title,
            copy.body,
            copy.status,
            JSON.stringify(copy.data),
            copy.version,
            copy.approvedVersion,
            copy.createdAt,
            copy.updatedAt,
          ],
        );
        const revisions = (
          await tx.query<{ snapshot: Entity; actor_id: string }>(
            "SELECT snapshot,actor_id FROM revisions WHERE record_id=$1 ORDER BY version",
            [p.id],
          )
        ).rows;
        for (const row of revisions) {
          const snapshot = {
            ...row.snapshot,
            id: copy.id,
            key: copy.key,
            taskId: task.id,
            projectId: task.projectId,
            data: { ...row.snapshot.data, scope: "task" },
          };
          await tx.query(
            "INSERT INTO revisions(record_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)",
            [copy.id, snapshot.version, JSON.stringify(snapshot), row.actor_id],
          );
        }
        await tx.query(
          "INSERT INTO reviews(id,task_id,record_id,version,status,comment,actor_id,created_at) SELECT $1||id,$2,$3,version,status,comment,actor_id,created_at FROM reviews WHERE record_id=$4",
          [copy.id + "-", task.id, copy.id, p.id],
        );
        await service.event(tx, owner, "principle_migrated", copy);
        replacements.set(p.id, copy.id);
      }
      if (replacements.size) {
        const data = {
          ...task.data,
          principles: task.data.principles?.map((p) => ({
            ...p,
            id: replacements.get(p.id) ?? p.id,
          })),
          principleChecks: task.data.principleChecks?.map((p) => ({
            ...p,
            id: replacements.get(p.id) ?? p.id,
          })),
        };
        await tx.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
          [task.id, JSON.stringify(data)],
        );
        const updated = await service.get(task.id, tx);
        await service.snapshot(tx, updated, owner);
        await service.event(tx, owner, "task_principles_migrated", updated);
      }
    }
    for (const p of legacy) {
      await tx.query(
        "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1",
        [p.id],
      );
      const archived = await service.get(p.id, tx);
      await service.snapshot(tx, archived, owner);
      await service.event(tx, owner, "principle_migrated", archived);
    }
    await tx.query("INSERT INTO schema_migrations(version) VALUES(2)");
  });
}
