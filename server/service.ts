import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./db.js";
import { digest } from "./security.js";
import {
  type Entity,
  type Actor,
  type Kind,
  type Data,
  type RecordInput,
  parseInput,
  authorize,
  canRead,
  ensure,
  defaultStatuses,
  reviewable,
  assertTransition,
  evaluateMatrix,
  coverage,
  completionGaps,
  applicablePrinciples,
  DomainError,
  isCurrent,
  activeTaskRecords,
  currentWorkspaceRecords,
} from "../shared/domain.js";
import { traceability } from "../shared/traceability.js";
type Row = {
  id: string;
  key: string;
  kind: Kind;
  task_id: string | null;
  project_id: string | null;
  title: string;
  body: string;
  status: string;
  data: Data;
  version: number;
  approved_version: number | null;
  sequence: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};
const iso = (d: Date | string) => new Date(d).toISOString();
export function entity(r: Row): Entity {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    taskId: r.task_id,
    projectId: r.project_id,
    title: r.title,
    body: r.body,
    status: r.status,
    data: r.data,
    version: r.version,
    approvedVersion: r.approved_version,
    sequence: Number(r.sequence),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
export const owner: Actor = {
  id: "system",
  name: "WorkHub",
  role: "owner",
  taskIds: ["*"],
  permissions: ["read", "write"],
};
export class Service {
  constructor(public db: Database) {}
  async all(tx: Sql = this.db) {
    return (
      await tx.query<Row>("SELECT * FROM records ORDER BY sequence")
    ).rows.map(entity);
  }
  async get(id: string, tx: Sql = this.db) {
    const row = (await tx.query<Row>("SELECT * FROM records WHERE id=$1", [id]))
      .rows[0];
    ensure(row, "NOT_FOUND", "内容不存在", 404);
    return entity(row);
  }
  async read(actor: Actor, id: string) {
    const e = await this.get(id);
    authorize(actor, "read", e);
    return e;
  }
  async list(actor: Actor, kind?: Kind, taskId?: string) {
    authorize(actor, "read");
    return (await this.all()).filter(
      (e) =>
        canRead(actor, e) &&
        (!kind || e.kind === kind) &&
        (!taskId || e.taskId === taskId),
    );
  }
  async lock(tx: Sql) {
    await tx.query(
      "INSERT INTO settings(key,value) VALUES('workspace_lock','{}') ON CONFLICT DO NOTHING",
    );
    await tx.query(
      "SELECT key FROM settings WHERE key='workspace_lock' FOR UPDATE",
    );
  }
  async mutation<T>(
    actor: Actor,
    key: string | undefined,
    body: unknown,
    fn: (tx: Sql) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const idem = key ? `${actor.id}:${key}` : null;
      const hash = digest(JSON.stringify(body));
      if (idem) {
        ensure(key!.length <= 200, "INVALID_KEY", "幂等键过长");
        const old = (
          await tx.query<{ request_hash: string; response: T }>(
            "SELECT * FROM idempotency WHERE key=$1",
            [idem],
          )
        ).rows[0];
        if (old) {
          ensure(
            old.request_hash === hash,
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键对应不同请求",
            409,
          );
          return old.response;
        }
      }
      const result = await fn(tx);
      if (idem)
        await tx.query(
          "INSERT INTO idempotency(key,request_hash,response) VALUES($1,$2,$3)",
          [idem, hash, JSON.stringify(result)],
        );
      return result;
    });
  }
  async event(tx: Sql, actor: Actor, action: string, e: Entity) {
    const taskId = e.kind === "task" ? e.id : e.taskId;
    await tx.query(
      "INSERT INTO events(task_id,actor_id,action,record_id,title) VALUES($1,$2,$3,$4,$5)",
      [taskId, actor.id, action, e.id, e.title],
    );
    if (taskId) {
      const config = (
        await tx.query<{ value: { autoSummary?: boolean } }>(
          "SELECT value FROM settings WHERE key='llm'",
        )
      ).rows[0]?.value;
      if (config?.autoSummary) {
        const pending = (
          await tx.query<{ id: string }>(
            "SELECT id FROM assistant_runs WHERE task_id=$1 AND question='__summary__' AND status='queued'",
            [taskId],
          )
        ).rows[0];
        if (pending)
          await tx.query(
            "UPDATE assistant_runs SET next_at=now()+interval '30 seconds',generation=generation+1 WHERE id=$1",
            [pending.id],
          );
        else
          await tx.query(
            "INSERT INTO assistant_runs(id,task_id,question,status,next_at) VALUES($1,$2,'__summary__','queued',now()+interval '30 seconds')",
            [randomUUID(), taskId],
          );
      }
    }
  }
  async snapshot(tx: Sql, e: Entity, actor: Actor) {
    await tx.query(
      "INSERT INTO revisions(record_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)",
      [e.id, e.version, JSON.stringify(e), actor.id],
    );
  }
  async validateRelations(input: RecordInput, actor: Actor, tx: Sql) {
    const taskKinds: Kind[] = [
      "requirement",
      "requirement_group",
      "principle",
      "criterion",
      "design",
      "work_item",
      "issue",
      "check",
      "result",
      "question",
    ];
    let task: Entity | undefined;
    if (taskKinds.includes(input.kind))
      ensure(input.taskId, "TASK_REQUIRED", "该内容必须属于任务");
    if (input.taskId) {
      task = await this.get(input.taskId, tx);
      ensure(task.kind === "task", "INVALID_PARENT", "任务引用无效");
      authorize(actor, "write", task);
      ensure(
        !["done", "cancelled"].includes(task.status),
        "TASK_CLOSED",
        "请先重新打开任务",
        409,
      );
      if (input.projectId)
        ensure(
          input.projectId === task.projectId,
          "INVALID_PROJECT",
          "内容必须与任务属于同一项目",
        );
      input.projectId = task.projectId;
    }
    if (input.projectId) {
      const p = await this.get(input.projectId, tx);
      ensure(p.kind === "project", "INVALID_PROJECT", "项目引用无效");
    }
    if (input.kind === "task")
      ensure(input.projectId, "PROJECT_REQUIRED", "请选择项目");
    if (input.kind === "project")
      ensure(
        !input.taskId && !input.projectId,
        "INVALID_PARENT",
        "项目不能嵌套",
      );
    if (input.kind === "task")
      ensure(!input.taskId, "INVALID_PARENT", "任务不能属于另一个任务");
    if (input.kind === "criterion") {
      const parent = await this.get(input.data!.requirementId!, tx);
      ensure(
        parent.kind === "requirement" && parent.taskId === input.taskId,
        "INVALID_LINK",
        "验收标准必须关联本任务的需求",
      );
      ensure(
        isCurrent(parent),
        "INACTIVE_REQUIREMENT",
        "请先恢复此需求，再编辑验收标准",
        409,
      );
    }
    if (input.kind === "requirement" && input.data?.groupId) {
      const group = await this.get(input.data.groupId, tx);
      ensure(
        group.kind === "requirement_group" &&
          group.taskId === input.taskId &&
          isCurrent(group),
        "INVALID_LINK",
        "分组必须属于当前任务",
      );
    }
    if (input.kind === "issue")
      for (const id of input.data?.checkIds ?? []) {
        const c = await this.get(id, tx);
        ensure(
          c.kind === "check" && c.taskId === input.taskId,
          "INVALID_LINK",
          "问题只能关联当前任务的测试用例",
        );
      }
    if (input.kind === "check") {
      for (const id of input.data!.criterionIds!) {
        const c = await this.get(id, tx);
        ensure(
          c.kind === "criterion" && c.taskId === input.taskId,
          "INVALID_LINK",
          "检查只能关联本任务的验收标准",
        );
      }
    }
    if (input.kind === "result") {
      const check = await this.get(input.data!.checkId!, tx);
      ensure(
        check.kind === "check" && check.taskId === input.taskId,
        "INVALID_LINK",
        "检查引用无效",
      );
      ensure(
        input.data!.checkVersion === check.version,
        "STALE_CHECK",
        "检查版本已变化，请重新读取上下文",
        409,
      );
      ensure(isCurrent(check), "INACTIVE_CASE", "测试用例已归档", 409);
      const requirementIds = new Set<string>();
      for (const cid of check.data.criterionIds!) {
        const c = await this.get(cid, tx);
        ensure(
          input.data!.criterionVersions![cid] === c.version,
          "STALE_CRITERION",
          "验收标准版本已变化",
          409,
        );
        const requirement = await this.get(c.data.requirementId!, tx);
        requirementIds.add(requirement.id);
        ensure(
          input.data!.requirementVersions?.[requirement.id] ===
            requirement.version,
          "STALE_REQUIREMENT",
          "需求版本已变化，请重新读取上下文并复验",
          409,
        );
      }
      ensure(
        Object.keys(input.data!.requirementVersions!).every((id) =>
          requirementIds.has(id),
        ),
        "INVALID_LINK",
        "验证记录包含无关需求",
      );
      ensure(
        Object.keys(input.data!.criterionVersions!).every((id) =>
          check.data.criterionIds!.includes(id),
        ),
        "INVALID_LINK",
        "验证记录包含无关验收标准",
      );
    }
    if (actor.role !== "owner" && input.approve) authorize(actor, "approve");
    if (actor.role !== "owner" && !input.taskId)
      ensure(actor.taskIds.includes("*"), "FORBIDDEN", "需要全局写入权限", 403);
  }
  async insert(tx: Sql, actor: Actor, raw: unknown): Promise<Entity> {
    const input = parseInput(raw);
    authorize(actor, "write");
    ensure(
      !input.data.waiver &&
        !input.data.targetTaskId &&
        !input.data.principles &&
        !input.data.principleChecks &&
        !input.data.disposition,
      "PROTECTED_FIELD",
      "此字段由业务操作维护",
    );
    await this.validateRelations(input, actor, tx);
    if (input.kind === "criterion" && input.data.applicable === false)
      authorize(actor, "approve");
    const id = randomUUID();
    let data = input.data;
    if (input.kind === "task") {
      data = {
        ...data,
        principles: (
          await this.activePrinciples(
            { id, projectId: input.projectId ?? null },
            tx,
          )
        ).map((p) => ({
          id: p.id,
          version: p.version,
          strength: p.data.strength,
        })),
      };
    }
    const approved =
      input.approve && reviewable.includes(input.kind) ? 1 : null;
    const status =
      input.kind === "principle" && approved
        ? "active"
        : defaultStatuses[input.kind];
    const count = (
      await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM records WHERE kind=$1",
        [input.kind],
      )
    ).rows[0].n;
    const prefix: Record<Kind, string> = {
      project: "PRJ",
      task: "TASK",
      requirement: "REQ",
      requirement_group: "GRP",
      criterion: "AC",
      design: "DES",
      work_item: "WORK",
      issue: "ISS",
      check: "CHK",
      result: "RUN",
      todo: "IDEA",
      principle: "PRN",
      question: "Q",
    };
    const key =
      prefix[input.kind] + "-" + String(Number(count) + 1).padStart(3, "0");
    const row = (
      await tx.query<Row>(
        "INSERT INTO records(id,key,kind,task_id,project_id,title,body,status,data,approved_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          id,
          key,
          input.kind,
          input.taskId ?? null,
          input.projectId ?? null,
          input.title,
          input.body,
          status,
          JSON.stringify(data),
          approved,
        ],
      )
    ).rows[0];
    const e = entity(row);
    await this.snapshot(tx, e, actor);
    await this.event(tx, actor, "created", e);
    return e;
  }
  async create(actor: Actor, input: unknown, key?: string) {
    authorize(actor, "write");
    return this.mutation(actor, key, { action: "create", input }, (tx) =>
      this.insert(tx, actor, input),
    );
  }
  async update(
    actor: Actor,
    id: string,
    version: number,
    patch: { title?: string; body?: string; data?: Data },
    key?: string,
  ) {
    authorize(actor, "write");
    return this.mutation(
      actor,
      key,
      { action: "update", id, version, patch },
      async (tx) => {
        const e = await this.get(id, tx);
        authorize(actor, "write", e);
        ensure(isCurrent(e), "INACTIVE_RECORD", "请先恢复此条目再编辑", 409);
        ensure(
          e.kind !== "result",
          "IMMUTABLE",
          "验证记录不可覆盖，请提交新的执行记录",
          409,
        );
        ensure(
          e.version === version,
          "VERSION_CONFLICT",
          "内容已被修改，请刷新后重试",
          409,
        );
        const parsed = parseInput({
          kind: e.kind,
          title: patch.title ?? e.title,
          body: patch.body ?? e.body,
          taskId: e.taskId,
          projectId: e.projectId,
          data: { ...e.data, ...patch.data },
        });
        if (patch.data)
          for (const field of [
            "waiver",
            "targetTaskId",
            "principles",
            "principleChecks",
            "disposition",
          ] as const)
            ensure(
              !(field in patch.data),
              "PROTECTED_FIELD",
              "此字段只能通过对应业务操作修改",
            );
        if (actor.role === "agent" && patch.data) {
          // Only the owner can lower a gate or switch the agreed task workflow.
          if (
            (e.data.required && patch.data.required === false) ||
            (e.data.blocking && patch.data.blocking === false) ||
            (e.kind === "task" &&
              patch.data.template &&
              patch.data.template !== e.data.template)
          ) {
            authorize(actor, "approve");
          }
        }
        if (
          e.kind === "criterion" &&
          parsed.data.applicable !== e.data.applicable
        )
          authorize(actor, "approve");
        await this.validateRelations(parsed, actor, tx);
        ensure(
          e.kind !== "task" || !["done", "cancelled"].includes(e.status),
          "TASK_CLOSED",
          "请先重新打开任务",
          409,
        );
        if (e.kind === "criterion") delete parsed.data.waiver;
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET title=$2,body=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, parsed.title, parsed.body, JSON.stringify(parsed.data)],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "updated", updated);
        return updated;
      },
    );
  }
  async changeStatus(
    actor: Actor,
    id: string,
    version: number,
    status: string,
    key?: string,
  ) {
    return this.mutation(
      actor,
      key,
      { action: "transition", id, version, status },
      async (tx) => {
        const e = await this.get(id, tx);
        ensure(e.version === version, "VERSION_CONFLICT", "内容已被修改", 409);
        assertTransition(e, status, actor);
        if (e.taskId) {
          const task = await this.get(e.taskId, tx);
          ensure(
            !["done", "cancelled"].includes(task.status),
            "TASK_CLOSED",
            "请先重新打开任务",
            409,
          );
        }
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, status],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "transitioned", updated);
        return updated;
      },
    );
  }
  async requestReview(actor: Actor, id: string, version: number, key?: string) {
    return this.mutation(
      actor,
      key,
      { action: "review", id, version },
      async (tx) => {
        const e = await this.get(id, tx);
        authorize(actor, "write", e);
        ensure(
          isCurrent(e),
          "INACTIVE_RECORD",
          "已拒绝或删除的条目不能提交评审",
          409,
        );
        if (e.kind === "criterion")
          ensure(
            isCurrent(await this.get(e.data.requirementId!, tx)),
            "INACTIVE_REQUIREMENT",
            "所属需求已退出当前范围",
            409,
          );
        ensure(
          reviewable.includes(e.kind),
          "NOT_REVIEWABLE",
          "该类型不支持评审",
        );
        ensure(
          e.version === version,
          "VERSION_CONFLICT",
          "内容版本已变化",
          409,
        );
        const rid = randomUUID();
        await tx.query(
          "INSERT INTO reviews(id,task_id,record_id,version,actor_id) VALUES($1,$2,$3,$4,$5)",
          [rid, e.taskId, e.id, version, actor.id],
        );
        await this.event(tx, actor, "review_requested", e);
        return { id: rid };
      },
    );
  }
  async approve(
    actor: Actor,
    id: string,
    version: number,
    comment = "",
    key?: string,
  ) {
    authorize(actor, "approve");
    return this.mutation(
      actor,
      key,
      { action: "approve", id, version, comment },
      async (tx) => {
        const e = await this.get(id, tx);
        ensure(isCurrent(e), "INACTIVE_RECORD", "请先恢复此条目再确认", 409);
        if (e.kind === "criterion")
          ensure(
            isCurrent(await this.get(e.data.requirementId!, tx)),
            "INACTIVE_REQUIREMENT",
            "所属需求已退出当前范围",
            409,
          );
        ensure(
          reviewable.includes(e.kind),
          "NOT_REVIEWABLE",
          "该类型不能被批准",
        );
        ensure(
          e.version === version,
          "VERSION_CONFLICT",
          "当前版本已变化，不能批准旧版本",
          409,
        );
        if (e.taskId)
          ensure(
            (await this.get(e.taskId, tx)).status !== "done",
            "TASK_CLOSED",
            "请先重新打开任务",
            409,
          );
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET approved_version=version,status=CASE WHEN kind='principle' THEN 'active' ELSE status END,updated_at=now() WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0],
        );
        await tx.query(
          "UPDATE reviews SET status='approved',comment=$3 WHERE record_id=$1 AND version=$2 AND status='pending'",
          [id, version, comment],
        );
        await tx.query(
          "INSERT INTO reviews(id,task_id,record_id,version,status,comment,actor_id) VALUES($1,$2,$3,$4,'approved',$5,$6)",
          [randomUUID(), e.taskId, id, version, comment, actor.id],
        );
        await this.event(tx, actor, "approved", updated);
        return updated;
      },
    );
  }
  async disposeRequirement(
    actor: Actor,
    id: string,
    version: number,
    action: "reject" | "delete" | "restore",
    reason: string,
    key?: string,
  ) {
    authorize(actor, "approve");
    return this.mutation(
      actor,
      key,
      { action, id, version, reason },
      async (tx) => {
        const r = await this.get(id, tx);
        ensure(r.kind === "requirement", "INVALID_KIND", "请选择需求");
        ensure(r.version === version, "VERSION_CONFLICT", "需求已变化", 409);
        const task = await this.get(r.taskId!, tx);
        ensure(
          !["done", "cancelled"].includes(task.status),
          "TASK_CLOSED",
          "请先重新打开任务",
          409,
        );
        ensure(
          action === "restore"
            ? ["rejected", "deleted"].includes(r.status)
            : action === "delete"
              ? r.status !== "deleted"
              : isCurrent(r),
          "INVALID_TRANSITION",
          "当前状态不支持此操作",
          409,
        );
        ensure(
          action === "restore" || reason.trim().length > 0,
          "REASON_REQUIRED",
          "请填写原因",
        );
        const data = {
          ...r.data,
          disposition: {
            reason: reason.trim(),
            actorId: actor.id,
            at: new Date().toISOString(),
            previousStatus: r.status,
          },
        };
        const status =
          action === "reject"
            ? "rejected"
            : action === "delete"
              ? "deleted"
              : "draft";
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET status=$2,data=$3,version=version+1,approved_version=NULL,updated_at=now() WHERE id=$1 RETURNING *",
              [id, status, JSON.stringify(data)],
            )
          ).rows[0],
        );
        await tx.query(
          "UPDATE reviews SET status='superseded' WHERE record_id=$1 AND status='pending'",
          [id],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "requirement_" + action, updated);
        return updated;
      },
    );
  }
  async assignTodo(
    actor: Actor,
    id: string,
    version: number,
    taskId: string | null,
    key?: string,
  ) {
    return this.mutation(
      actor,
      key,
      { action: "assign_todo", id, version, taskId },
      async (tx) => {
        const r = await this.get(id, tx);
        authorize(actor, "write", r);
        ensure(r.kind === "todo", "INVALID_KIND", "请选择待办");
        ensure(r.version === version, "VERSION_CONFLICT", "待办已变化", 409);
        ensure(
          !r.data.targetTaskId && isCurrent(r),
          "INVALID_TRANSITION",
          "该待办无法转移",
          409,
        );
        if (r.taskId)
          ensure(
            !["done", "cancelled"].includes(
              (await this.get(r.taskId, tx)).status,
            ),
            "TASK_CLOSED",
            "请先重新打开任务",
            409,
          );
        const target = taskId ? await this.get(taskId, tx) : null;
        if (target) {
          authorize(actor, "write", target);
          ensure(target.kind === "task", "INVALID_KIND", "请选择任务");
          ensure(
            !["done", "cancelled"].includes(target.status),
            "TASK_CLOSED",
            "任务已经关闭",
            409,
          );
        } else
          ensure(
            actor.role === "owner" || actor.taskIds.includes("*"),
            "FORBIDDEN",
            "不能移出授权任务",
            403,
          );
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET task_id=$2,project_id=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, taskId, target?.projectId ?? r.projectId],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "todo_assigned", updated);
        return updated;
      },
    );
  }
  async archive(actor: Actor, id: string, version: number) {
    authorize(actor, "approve");
    return this.mutation(
      actor,
      undefined,
      { action: "archive", id, version },
      async (tx) => {
        const e = await this.get(id, tx);
        ensure(e.version === version, "VERSION_CONFLICT", "内容已变化", 409);
        ensure(
          !["project", "task", "result", "requirement"].includes(e.kind),
          "INVALID_ARCHIVE",
          "此类型不能归档",
        );
        if (e.taskId)
          ensure(
            (await this.get(e.taskId, tx)).status !== "done",
            "TASK_CLOSED",
            "请先重新打开任务",
            409,
          );
        const all = await this.all(tx);
        ensure(
          !all.some(
            (r) =>
              r.status !== "archived" &&
              (r.data.requirementId === id ||
                r.data.groupId === id ||
                r.data.checkId === id ||
                r.data.criterionIds?.includes(id) ||
                r.data.checkIds?.includes(id)),
          ),
          "REFERENCED",
          "仍有内容引用它，请先处理关联",
          409,
        );
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "archived", updated);
        return updated;
      },
    );
  }
  async convertTodo(
    actor: Actor,
    id: string,
    version: number,
    projectId: string,
    key?: string,
  ) {
    authorize(actor, "write");
    return this.mutation(
      actor,
      key,
      { action: "convert", id, version, projectId },
      async (tx) => {
        const todo = await this.get(id, tx);
        authorize(actor, "write", todo);
        ensure(todo.kind === "todo", "INVALID_KIND", "请选择待办");
        ensure(todo.version === version, "VERSION_CONFLICT", "待办已变化", 409);
        ensure(
          !todo.data.targetTaskId,
          "ALREADY_CONVERTED",
          "此待办已经转为任务",
          409,
        );
        const task = await this.insert(tx, actor, {
          kind: "task",
          title: todo.title,
          body: todo.body,
          projectId,
          data: { type: "feature", template: "light" },
        });
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET status='converted',data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, JSON.stringify({ ...todo.data, targetTaskId: task.id })],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "converted", updated);
        return task;
      },
    );
  }
  async waive(actor: Actor, id: string, version: number, reason: string) {
    authorize(actor, "waive");
    return this.mutation(
      actor,
      undefined,
      { action: "waive", id, version, reason },
      async (tx) => {
        const c = await this.get(id, tx);
        ensure(
          c.kind === "criterion" && c.taskId,
          "INVALID_KIND",
          "只能豁免验收标准",
        );
        ensure(c.version === version, "VERSION_CONFLICT", "版本已变化", 409);
        ensure(reason.trim(), "REASON_REQUIRED", "请填写豁免理由");
        const requirement = await this.get(c.data.requirementId!, tx);
        ensure(
          isCurrent(c) && isCurrent(requirement),
          "INACTIVE_REQUIREMENT",
          "需求或标准不在当前范围内",
          409,
        );
        const task = await this.get(c.taskId, tx);
        ensure(task.status !== "done", "TASK_CLOSED", "请先重新打开任务", 409);
        const data = {
          ...c.data,
          waiver: {
            reason,
            version: c.version,
            requirementVersion: requirement.version,
            codeRef: task.data.codeRef ?? "",
          },
        };
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET data=$2,updated_at=now() WHERE id=$1 RETURNING *",
              [id, JSON.stringify(data)],
            )
          ).rows[0],
        );
        await this.event(tx, actor, "waived: " + reason, updated);
        return updated;
      },
    );
  }
  async adoptPrinciples(actor: Actor, id: string, version: number) {
    authorize(actor, "approve");
    return this.mutation(
      actor,
      undefined,
      { action: "adopt", id, version },
      async (tx) => {
        const t = await this.get(id, tx);
        ensure(
          t.kind === "task" && t.version === version,
          "VERSION_CONFLICT",
          "任务版本已变化",
          409,
        );
        ensure(t.status !== "done", "TASK_CLOSED", "请先重新打开任务", 409);
        const data = {
          ...t.data,
          principles: (await this.activePrinciples(t, tx)).map((p) => ({
            id: p.id,
            version: p.version,
            strength: p.data.strength,
          })),
        };
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, JSON.stringify(data)],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "principles_adopted", updated);
        return updated;
      },
    );
  }
  async activePrinciples(
    task: Pick<Entity, "id" | "projectId">,
    tx: Sql = this.db,
  ) {
    const candidates = (await this.all(tx)).filter(
      (p) =>
        p.kind === "principle" && p.status === "active" && p.approvedVersion,
    );
    const snapshots: Entity[] = [];
    for (const p of candidates) {
      const row = (
        await tx.query<{ snapshot: Entity }>(
          "SELECT snapshot FROM revisions WHERE record_id=$1 AND version=$2",
          [p.id, p.approvedVersion],
        )
      ).rows[0];
      if (row)
        snapshots.push({
          ...row.snapshot,
          status: "active",
          approvedVersion: p.approvedVersion,
        });
    }
    return applicablePrinciples(task, snapshots);
  }
  async confirmPrinciple(
    actor: Actor,
    id: string,
    version: number,
    principleId: string,
    note: string,
    key?: string,
  ) {
    authorize(actor, "approve");
    return this.mutation(
      actor,
      key,
      { action: "principle_check", id, version, principleId, note },
      async (tx) => {
        const task = await this.get(id, tx);
        ensure(task.kind === "task", "INVALID_KIND", "请选择任务");
        ensure(
          task.version === version,
          "VERSION_CONFLICT",
          "任务版本已变化",
          409,
        );
        ensure(
          !["done", "cancelled"].includes(task.status),
          "TASK_CLOSED",
          "请先重新打开任务",
          409,
        );
        ensure(task.data.codeRef, "CODE_REQUIRED", "请先登记目标 commit SHA");
        const ref = task.data.principles?.find((p) => p.id === principleId);
        ensure(ref, "INVALID_LINK", "该原则不在任务采用的基线中");
        ensure(
          note.trim().length > 0 && note.length <= 2000,
          "REASON_REQUIRED",
          "请填写核对依据，最多 2000 字",
        );
        const data = {
          ...task.data,
          principleChecks: [
            ...(task.data.principleChecks ?? []).filter(
              (p) => p.id !== principleId,
            ),
            {
              id: principleId,
              version: ref.version,
              codeRef: task.data.codeRef,
              note: note.trim(),
              actorId: actor.id,
            },
          ],
        };
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id, JSON.stringify(data)],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "principle_checked", updated);
        return updated;
      },
    );
  }
  async report(actor: Actor, taskId: string, tx: Sql = this.db) {
    const t = await this.get(taskId, tx);
    authorize(actor, "read", t);
    ensure(t.kind === "task", "INVALID_KIND", "请选择任务");
    const all = await this.all(tx);
    const rows = evaluateMatrix(t, all);
    return {
      task: t,
      rows,
      metrics: coverage(rows),
      gaps: completionGaps(t, all),
      asOf: new Date().toISOString(),
      traceability: traceability(t, all),
      metricVersion: 2,
    };
  }
  async saveReport(actor: Actor, taskId: string, key?: string) {
    authorize(actor, "write");
    return this.mutation(
      actor,
      key,
      { action: "report", taskId },
      async (tx) => {
        const data = await this.report(actor, taskId, tx);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO reports(id,task_id,data) VALUES($1,$2,$3)",
          [id, taskId, JSON.stringify(data)],
        );
        return { id, ...data };
      },
    );
  }
  async accept(actor: Actor, id: string, version: number, key?: string) {
    authorize(actor, "accept");
    return this.mutation(
      actor,
      key,
      { action: "accept", id, version },
      async (tx) => {
        const report = await this.report(actor, id, tx);
        ensure(
          report.task.version === version,
          "VERSION_CONFLICT",
          "任务版本已变化",
          409,
        );
        ensure(
          !["done", "cancelled"].includes(report.task.status),
          "TASK_CLOSED",
          "任务已经关闭",
          409,
        );
        if (report.gaps.length)
          throw new DomainError(
            "ACCEPTANCE_BLOCKED",
            "尚未满足验收条件",
            409,
            report.gaps,
          );
        await tx.query(
          "INSERT INTO reports(id,task_id,data,kind) VALUES($1,$2,$3,'acceptance')",
          [randomUUID(), id, JSON.stringify(report)],
        );
        const updated = entity(
          (
            await tx.query<Row>(
              "UPDATE records SET status='done',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0],
        );
        await this.snapshot(tx, updated, actor);
        await this.event(tx, actor, "accepted", updated);
        return updated;
      },
    );
  }
  async context(actor: Actor, taskId?: string) {
    const all = await this.all();
    const visible = all.filter((e) => canRead(actor, e));
    authorize(actor, "read");
    if (!taskId)
      return {
        scope: "workspace",
        records: currentWorkspaceRecords(visible),
        generatedAt: new Date().toISOString(),
      };
    const task = await this.read(actor, taskId);
    ensure(task.kind === "task", "INVALID_KIND", "请选择任务");
    const principles: Entity[] = [];
    for (const ref of task.data.principles ?? []) {
      const r = (
        await this.db.query<{ snapshot: Entity }>(
          "SELECT snapshot FROM revisions WHERE record_id=$1 AND version=$2",
          [ref.id, ref.version],
        )
      ).rows[0];
      if (r) principles.push(r.snapshot);
    }
    return {
      scope: "task",
      task,
      records: activeTaskRecords(task, visible),
      excludedRequirements: visible.filter(
        (e) => e.taskId === taskId && e.kind === "requirement" && !isCurrent(e),
      ),
      principles,
      availablePrincipleUpdates: (await this.activePrinciples(task)).filter(
        (p) =>
          !task.data.principles?.some(
            (ref) => ref.id === p.id && ref.version === p.approvedVersion,
          ),
      ),
      report: await this.report(actor, taskId),
      generatedAt: new Date().toISOString(),
    };
  }
  async history(actor: Actor, id: string) {
    await this.read(actor, id);
    return (
      await this.db.query(
        "SELECT version,snapshot,actor_id FROM revisions WHERE record_id=$1 ORDER BY version DESC",
        [id],
      )
    ).rows;
  }
  async events(actor: Actor, after = 0) {
    authorize(actor, "read");
    const rows = (
      await this.db.query<{
        id: string;
        task_id: string | null;
        record_id: string | null;
        action: string;
        title: string;
        created_at: string;
      }>("SELECT * FROM events WHERE id>$1 ORDER BY id LIMIT 1000", [after])
    ).rows;
    const visible = new Set((await this.list(actor)).map((e) => e.id));
    return {
      items: rows.filter(
        (e) =>
          actor.role === "owner" || (e.record_id && visible.has(e.record_id)),
      ),
      cursor: rows.at(-1)?.id ?? after,
    };
  }
}
