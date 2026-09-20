import { z } from "zod";

export const kinds = [
  "project",
  "task",
  "requirement",
  "requirement_group",
  "criterion",
  "design",
  "work_item",
  "issue",
  "check",
  "result",
  "todo",
  "principle",
  "question",
] as const;
export type Kind = (typeof kinds)[number];
export type Actor = {
  id: string;
  name: string;
  role: "owner" | "agent";
  taskIds: string[];
  permissions: string[];
};
export type Data = {
  type?: string;
  priority?: string;
  template?: string;
  codeRef?: string;
  tags?: string[];
  requirementId?: string;
  groupId?: string | null;
  order?: number;
  disposition?: {
    reason: string;
    actorId: string;
    at: string;
    previousStatus: string;
  };
  criterionIds?: string[];
  checkId?: string;
  checkVersion?: number;
  criterionVersions?: Record<string, number>;
  requirementVersions?: Record<string, number>;
  preconditions?: string;
  steps?: string;
  expectedResult?: string;
  automationRef?: string;
  checkIds?: string[];
  outcome?: string;
  evidence?: string;
  environment?: string;
  required?: boolean;
  blocking?: boolean;
  severity?: string;
  assignee?: string;
  targetTaskId?: string;
  scope?: string;
  strength?: string;
  category?: string;
  rationale?: string;
  principles?: { id: string; version: number; strength?: string }[];
  principleChecks?: {
    id: string;
    version: number;
    codeRef: string;
    note: string;
    actorId: string;
  }[];
  waiver?: {
    reason: string;
    codeRef: string;
    version: number;
    requirementVersion?: number;
  };
  applicable?: boolean;
  exclusionReason?: string;
  approvedBy?: string;
};
export type Entity = {
  id: string;
  key: string;
  kind: Kind;
  taskId: string | null;
  projectId: string | null;
  title: string;
  body: string;
  status: string;
  data: Data;
  version: number;
  approvedVersion: number | null;
  createdAt: string;
  updatedAt: string;
  sequence: number;
};
export type RecordInput = {
  kind: Kind;
  title: string;
  body?: string;
  taskId?: string | null;
  projectId?: string | null;
  data?: Data;
  approve?: boolean;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
const text = z.string().trim().max(20000);
const id = z.string().min(1).max(100);
const common = {
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
};
export const dataSchemas: Record<Kind, z.ZodTypeAny> = {
  project: z.object(common).strict(),
  task: z
    .object({
      ...common,
      type: z
        .enum(["feature", "bug", "refactor", "research", "chore"])
        .default("feature"),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      template: z.enum(["light", "standard"]).default("light"),
      codeRef: z
        .string()
        .regex(/^$|^[a-fA-F0-9]{40}$/, "代码目标须为完整的 40 位 commit SHA")
        .default(""),
      principles: z
        .array(
          z.object({
            id,
            version: z.number().int().positive(),
            strength: z.enum(["required", "recommended"]).optional(),
          }),
        )
        .optional(),
      principleChecks: z
        .array(
          z.object({
            id,
            version: z.number().int().positive(),
            codeRef: z.string(),
            note: text.min(1),
            actorId: id,
          }),
        )
        .optional(),
    })
    .strict(),
  requirement: z
    .object({
      priority: z.enum(["must", "should", "could"]).default("must"),
      groupId: id.nullable().optional(),
      disposition: z
        .object({
          reason: text,
          actorId: id,
          at: z.string(),
          previousStatus: z.string(),
        })
        .optional(),
    })
    .strict(),
  requirement_group: z.object({ order: z.number().int().default(0) }).strict(),
  criterion: z
    .object({
      requirementId: id,
      applicable: z.boolean().default(true),
      exclusionReason: text.optional(),
      waiver: z
        .object({
          reason: text.min(1),
          codeRef: z.string(),
          version: z.number().int(),
          requirementVersion: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .strict(),
  design: z
    .object({
      category: z
        .enum(["architecture", "module", "interface", "testing", "decision"])
        .default("architecture"),
      required: z.boolean().default(false),
    })
    .strict(),
  work_item: z
    .object({
      assignee: z.string().max(100).default(""),
      required: z.boolean().default(true),
    })
    .strict(),
  issue: z
    .object({
      severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
      blocking: z.boolean().default(false),
      checkIds: z.array(id).max(100).default([]),
    })
    .strict(),
  check: z
    .object({
      criterionIds: z.array(id).max(100).default([]),
      preconditions: text.default(""),
      steps: text.default(""),
      expectedResult: text.default(""),
      automationRef: z.string().trim().max(2000).default(""),
      type: z
        .enum([
          "unit",
          "integration",
          "concurrency",
          "performance",
          "manual",
          "compatibility",
        ])
        .default("unit"),
      required: z.boolean().default(true),
    })
    .strict(),
  result: z
    .object({
      checkId: id,
      checkVersion: z.number().int().positive(),
      criterionVersions: z.record(z.number().int().positive()),
      requirementVersions: z.record(z.number().int().positive()),
      codeRef: z.string().regex(/^[a-fA-F0-9]{40}$/),
      outcome: z.enum(["passed", "failed", "blocked", "skipped", "error"]),
      evidence: text.min(1),
      environment: z.string().trim().min(1).max(500),
    })
    .strict(),
  todo: z
    .object({
      type: z.enum(["idea", "todo"]).default("idea"),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
      ...common,
      targetTaskId: id.optional(),
    })
    .strict(),
  principle: z
    .object({
      scope: z.literal("task").default("task"),
      strength: z.enum(["required", "recommended"]).default("recommended"),
      category: z.string().max(40).default("architecture"),
      rationale: text.default(""),
    })
    .strict(),
  question: z.object({ blocking: z.boolean().default(false) }).strict(),
};
export const inputSchema = z
  .object({
    kind: z.enum(kinds),
    title: z.string().trim().min(1, "请填写标题").max(200),
    body: text.default(""),
    taskId: id.nullable().optional(),
    projectId: id.nullable().optional(),
    data: z.record(z.unknown()).default({}),
    approve: z.boolean().default(false),
  })
  .strict();
export function parseInput(
  value: unknown,
): RecordInput & { body: string; data: Data; approve: boolean } {
  const input = inputSchema.parse(value);
  const data = dataSchemas[input.kind].parse(input.data) as Data;
  if (input.kind === "criterion" && data.applicable === false)
    ensure(
      data.exclusionReason?.trim(),
      "EXCLUSION_REASON",
      "不适用条目必须说明原因",
    );
  return { ...input, data };
}
export const defaultStatuses: Record<Kind, string> = {
  project: "active",
  task: "draft",
  requirement: "draft",
  requirement_group: "active",
  criterion: "draft",
  design: "draft",
  work_item: "todo",
  issue: "open",
  check: "draft",
  result: "recorded",
  todo: "inbox",
  principle: "draft",
  question: "open",
};
export const reviewable: Kind[] = [
  "requirement",
  "criterion",
  "design",
  "check",
  "principle",
];
export function canRead(actor: Actor, entity: Entity) {
  return (
    actor.role === "owner" ||
    actor.taskIds.includes("*") ||
    actor.taskIds.includes(
      entity.kind === "task"
        ? entity.id
        : (entity.taskId ?? entity.data.targetTaskId ?? ""),
    )
  );
}
export function authorize(actor: Actor, action: string, entity?: Entity) {
  if (actor.role === "owner") return;
  ensure(
    !["approve", "accept", "waive", "configure", "publish", "restore"].includes(
      action,
    ),
    "FORBIDDEN",
    "此操作需要 Owner 权限",
    403,
  );
  ensure(
    actor.permissions.includes(action),
    "FORBIDDEN",
    "Agent 未获授此操作权限",
    403,
  );
  if (entity)
    ensure(canRead(actor, entity), "FORBIDDEN", "该内容不在授权范围内", 403);
}
const transitions: Partial<Record<Kind, Record<string, string[]>>> = {
  task: {
    draft: ["active", "cancelled"],
    active: ["blocked", "ready_for_acceptance", "cancelled"],
    blocked: ["active", "cancelled"],
    ready_for_acceptance: ["active", "blocked", "cancelled"],
    done: ["active"],
    cancelled: ["active"],
  },
  work_item: {
    todo: ["doing", "blocked", "done", "cancelled"],
    doing: ["done", "blocked", "todo", "cancelled"],
    blocked: ["doing", "todo", "cancelled"],
    done: ["doing"],
    cancelled: ["todo"],
  },
  issue: {
    open: ["in_progress", "resolved"],
    in_progress: ["resolved", "open"],
    resolved: ["verified", "open"],
    verified: ["closed", "open"],
    closed: ["open"],
  },
  todo: {
    inbox: ["planned", "done", "archived"],
    planned: ["inbox", "done", "archived"],
    converted: ["archived"],
    done: ["inbox", "archived"],
    archived: ["inbox"],
  },
  question: { open: ["resolved"], resolved: ["open"] },
};
export function assertTransition(entity: Entity, next: string, actor: Actor) {
  authorize(actor, "write", entity);
  ensure(
    transitions[entity.kind]?.[entity.status]?.includes(next),
    "INVALID_TRANSITION",
    `不能从 ${entity.status} 切换为 ${next}`,
    409,
  );
  if (
    (entity.kind === "task" && entity.status === "done") ||
    (entity.kind === "work_item" &&
      entity.data.required !== false &&
      next === "cancelled") ||
    (entity.kind === "question" && next === "resolved")
  )
    authorize(actor, "approve");
}
export function availableTransitions(entity: Entity) {
  return transitions[entity.kind]?.[entity.status] ?? [];
}
export const isCurrent = (e: Entity) =>
  !["archived", "rejected", "deleted"].includes(e.status);
export function activeTaskRecords(task: Pick<Entity, "id">, records: Entity[]) {
  const local = records.filter((e) => e.taskId === task.id && isCurrent(e));
  const reqIds = new Set(
    local.filter((e) => e.kind === "requirement").map((e) => e.id),
  );
  const acIds = new Set(
    local
      .filter(
        (e) => e.kind === "criterion" && reqIds.has(e.data.requirementId!),
      )
      .map((e) => e.id),
  );
  return local.filter((e) =>
    e.kind === "criterion"
      ? acIds.has(e.id)
      : e.kind === "check"
        ? !e.data.criterionIds?.length ||
          e.data.criterionIds.some((id) => acIds.has(id))
        : true,
  );
}
export function evidenceState(
  task: Entity,
  check: Entity,
  criterion: Entity,
  requirement: Entity | undefined,
  result?: Entity,
): MatrixState {
  if (!result) return "missing";
  const current =
    !!task.data.codeRef &&
    result.data.codeRef === task.data.codeRef &&
    result.data.checkVersion === check.version &&
    result.data.criterionVersions?.[criterion.id] === criterion.version &&
    !!requirement &&
    result.data.requirementVersions?.[requirement.id] === requirement.version;
  return current ? (result.data.outcome as MatrixState) : "stale";
}
export function currentWorkspaceRecords(records: Entity[]) {
  const activeIds = new Set(
    records
      .filter((e) => e.kind === "task")
      .flatMap((task) => activeTaskRecords(task, records))
      .map((e) => e.id),
  );
  return records.filter((e) => (e.taskId ? activeIds.has(e.id) : isCurrent(e)));
}
export type MatrixState =
  | "passed"
  | "failed"
  | "missing"
  | "stale"
  | "blocked"
  | "skipped"
  | "error"
  | "waived"
  | "not_applicable";
export type MatrixRow = {
  criterion: Entity;
  requirement?: Entity;
  checks: { check: Entity; result?: Entity; state: MatrixState }[];
  state: MatrixState;
};
export function evaluateMatrix(task: Entity, records: Entity[]): MatrixRow[] {
  const active = activeTaskRecords(task, records);
  return active
    .filter((e) => e.kind === "criterion")
    .map((criterion) => {
      const checks = active
        .filter(
          (e) =>
            e.kind === "check" && e.data.criterionIds?.includes(criterion.id),
        )
        .map((check) => {
          const results = active
            .filter((e) => e.kind === "result" && e.data.checkId === check.id)
            .sort((a, b) => b.sequence - a.sequence);
          const result = results[0];
          const state = evidenceState(
            task,
            check,
            criterion,
            active.find((e) => e.id === criterion.data.requirementId),
            result,
          );
          return { check, result, state };
        });
      const required = checks.filter((c) => c.check.data.required !== false);
      let state: MatrixState = "missing";
      if (
        criterion.data.applicable === false &&
        criterion.approvedVersion === criterion.version
      )
        state = "not_applicable";
      else if (
        criterion.data.waiver &&
        criterion.data.waiver.version === criterion.version &&
        criterion.data.waiver.requirementVersion ===
          active.find((r) => r.id === criterion.data.requirementId)?.version &&
        criterion.data.waiver.codeRef === task.data.codeRef
      )
        state = "waived";
      else if (required.length) {
        const order: MatrixState[] = [
          "failed",
          "error",
          "blocked",
          "stale",
          "missing",
          "skipped",
        ];
        state =
          order.find((s) => required.some((c) => c.state === s)) ?? "passed";
      }
      return {
        criterion,
        requirement: active.find((e) => e.id === criterion.data.requirementId),
        checks,
        state,
      };
    });
}
export function coverage(rows: MatrixRow[]) {
  const applicable = rows.filter((r) => r.state !== "not_applicable");
  const total = applicable.length;
  const passed = applicable.filter((r) => r.state === "passed").length;
  const linked = applicable.filter((r) => r.checks.length > 0).length;
  const executed = applicable.filter((r) => {
    const required = r.checks.filter((c) => c.check.data.required !== false);
    return (
      required.length > 0 &&
      required.every((c) => ["passed", "failed"].includes(c.state))
    );
  }).length;
  return {
    total,
    passed,
    linked,
    executed,
    waived: applicable.filter((r) => r.state === "waived").length,
    notApplicable: rows.length - total,
    passRate: total ? passed / total : null,
    linkRate: total ? linked / total : null,
    executionRate: total ? executed / total : null,
  };
}
export function completionGaps(task: Entity, records: Entity[]) {
  const items = activeTaskRecords(task, records);
  const rows = evaluateMatrix(task, records);
  const gaps: string[] = [];
  if (
    task.data.principles?.some(
      (p) =>
        p.strength === "required" &&
        !task.data.principleChecks?.some(
          (c) =>
            c.id === p.id &&
            c.version === p.version &&
            c.codeRef === task.data.codeRef,
        ),
    )
  )
    gaps.push("必需原则尚未完成当前代码版本的人工核对");
  if (!task.data.codeRef) gaps.push("尚未登记目标 commit SHA");
  if (!rows.length) gaps.push("至少需要一条验收标准");
  const requirements = items.filter((r) => r.kind === "requirement");
  if (!requirements.length) gaps.push("至少需要一项需求");
  if (
    items.some(
      (e) =>
        e.kind === "check" &&
        e.data.required !== false &&
        !e.data.criterionIds?.length,
    )
  )
    gaps.push("必需测试用例尚未关联验收标准");
  if (
    requirements.some(
      (r) => !rows.some((row) => row.criterion.data.requirementId === r.id),
    )
  )
    gaps.push("部分需求尚无验收标准");
  if (
    items.some(
      (r) =>
        ["requirement", "criterion", "check"].includes(r.kind) &&
        r.approvedVersion !== r.version,
    )
  )
    gaps.push("需求、验收标准或检查仍有未确认版本");
  const designs = items.filter((r) => r.kind === "design");
  if (
    task.data.template === "standard" &&
    !designs.some((d) => d.data.required)
  )
    gaps.push("标准流程至少需要一份必需设计");
  if (designs.some((d) => d.data.required && d.approvedVersion !== d.version))
    gaps.push("必需设计尚未确认");
  if (
    items.some(
      (r) =>
        r.kind === "work_item" &&
        r.data.required !== false &&
        !["done", "cancelled"].includes(r.status),
    )
  )
    gaps.push("必需实施事项尚未完成");
  if (
    items.some(
      (r) =>
        r.kind === "issue" &&
        r.data.blocking &&
        !["verified", "closed"].includes(r.status),
    )
  )
    gaps.push("仍有未复核的阻塞问题");
  if (
    items.some(
      (r) =>
        r.kind === "question" && r.data.blocking && r.status !== "resolved",
    )
  )
    gaps.push("仍有待决的阻塞疑问");
  if (
    rows.some((r) => !["passed", "waived", "not_applicable"].includes(r.state))
  )
    gaps.push("部分验收标准缺少当前有效的通过证据");
  return gaps;
}
export function applicablePrinciples(
  task: Pick<Entity, "id" | "projectId">,
  principles: Entity[],
) {
  return principles.filter(
    (p) =>
      p.kind === "principle" && p.status === "active" && p.taskId === task.id,
  );
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportCsv(rows: MatrixRow[]) {
  return (
    "\uFEFF" +
    [
      [
        "需求编号",
        "需求",
        "需求版本",
        "标准编号",
        "验收标准",
        "标准版本",
        "用例编号",
        "用例版本",
        "状态",
        "执行编号",
        "代码版本",
        "代码证据",
      ],
      ...rows.map((r) => [
        r.requirement?.key ?? "",
        r.requirement?.title ?? "",
        r.requirement?.version ?? "",
        r.criterion.key,
        r.criterion.title,
        r.criterion.version,
        r.checks.map((c) => c.check.key).join("；"),
        r.checks.map((c) => c.check.version).join("；"),
        r.state,
        r.checks.map((c) => c.result?.key ?? "").join("；"),
        r.checks.map((c) => c.result?.data.codeRef ?? "").join("；"),
        r.checks.map((c) => c.result?.data.evidence ?? "").join("；"),
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export const labels: Record<string, string> = {
  project: "项目",
  task: "任务",
  requirement: "需求",
  requirement_group: "需求分组",
  criterion: "验收标准",
  design: "设计",
  work_item: "实施事项",
  issue: "问题",
  check: "测试用例",
  result: "验证记录",
  todo: "待办",
  principle: "原则",
  question: "疑问",
  draft: "草稿",
  active: "进行中",
  blocked: "已阻塞",
  ready_for_acceptance: "待验收",
  done: "已完成",
  cancelled: "已取消",
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  verified: "已复核",
  closed: "已关闭",
  inbox: "待整理",
  planned: "已安排",
  converted: "已转任务",
  archived: "已归档",
  rejected: "已拒绝",
  deleted: "已删除",
  unlinked: "未关联",
  out_of_scope: "范围外",
  doing: "进行中",
  passed: "通过",
  failed: "失败",
  missing: "未验证",
  stale: "待复验",
  skipped: "已跳过",
  error: "执行错误",
  waived: "已豁免",
  not_applicable: "不适用",
  feature: "新功能",
  bug: "缺陷修复",
  refactor: "重构",
  research: "调研",
  chore: "维护",
  low: "低",
  medium: "普通",
  high: "高",
  urgent: "紧急",
  critical: "严重",
  idea: "想法",
  global: "全局",
  recommended: "建议",
  required: "必需",
  unit: "单元测试",
  integration: "集成测试",
  concurrency: "并发测试",
  performance: "性能测试",
  manual: "人工验证",
  compatibility: "兼容性测试",
  architecture: "架构",
  module: "模块",
  interface: "接口",
  testing: "测试",
  decision: "决策",
  must: "必须",
  should: "应该",
  could: "可选",
  recorded: "已记录",
};
