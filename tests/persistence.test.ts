import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../server/db";
import { Service, owner } from "../server/service";
it("persists committed records and idempotency across a database restart, while rolling back failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "workhub-persistence-"));
  let db = await openDatabase(undefined, root);
  try {
    const service = new Service(db),
      input = { kind: "todo", title: "Survives restart" };
    const original = await service.create(owner, input, "restart-key");
    await expect(
      db.transaction(async (tx) => {
        await tx.query("UPDATE records SET title='lost change' WHERE id=$1", [
          original.id,
        ]);
        throw new Error("Abort");
      }),
    ).rejects.toThrow("Abort");
    // Simulate an existing installation before the metadata column was added.
    await db.query("ALTER TABLE records DROP COLUMN starred");
    await db.close();
    db = await openDatabase(undefined, root);
    const reopened = new Service(db);
    expect((await reopened.get(original.id)).title).toBe("Survives restart");
    expect((await reopened.create(owner, input, "restart-key")).id).toBe(
      original.id,
    );
    expect(await reopened.all()).toHaveLength(1);
    expect((await reopened.get(original.id)).starred).toBe(false);
    const marked = await reopened.setStarred(
      owner,
      original.id,
      true,
      "persist-star",
    );
    await db.close();
    db = await openDatabase(undefined, root);
    expect(await new Service(db).get(original.id)).toEqual(marked);
    expect(
      await new Service(db).setStarred(
        owner,
        original.id,
        true,
        "persist-star",
      ),
    ).toEqual(marked);
  } finally {
    await db.close();
    const target = resolve(root);
    if (
      !target.startsWith(resolve(tmpdir()) + "\\") &&
      !target.startsWith(resolve(tmpdir()) + "/")
    )
      throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
