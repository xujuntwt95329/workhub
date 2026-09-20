import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Check,
  ChevronDown,
  LoaderCircle,
  Plus,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { diffLines } from "diff";
import {
  type Entity,
  type Kind,
  type Data,
  labels,
  isCurrent,
} from "../shared/domain";
import { api, post } from "./lib/api";
export function Badge({
  value,
  children,
}: {
  value?: string;
  children?: ReactNode;
}) {
  return (
    <span className={"badge badge-" + (value ?? "default")}>
      {children ?? labels[value ?? ""] ?? value}
    </span>
  );
}
export function Empty({
  title = "还没有内容",
  description = "从一个小小的想法开始，让工作慢慢变得清晰。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileText size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Button({
  children,
  onClick,
  variant = "",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,textarea,button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea,select,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export type EditorSpec = {
  kind: Kind;
  entity?: Entity;
  taskId?: string;
  requirementId?: string;
  groupId?: string;
  criterionIds?: string[];
  checkId?: string;
};
export function Editor({
  spec,
  records,
  onClose,
  onSaved,
}: {
  spec: EditorSpec;
  records: Entity[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { entity: e, kind } = spec;
  const [taskId, setTaskId] = useState(spec.taskId ?? e?.taskId ?? undefined);
  const [title, setTitle] = useState(e?.title ?? ""),
    [body, setBody] = useState(e?.body ?? ""),
    [data, setData] = useState<Data>(
      e?.data ?? {
        ...(kind === "principle" ? { scope: "task" as const } : {}),
        ...(spec.groupId ? { groupId: spec.groupId } : {}),
        ...(spec.criterionIds ? { criterionIds: spec.criterionIds } : {}),
        ...(spec.checkId ? { checkId: spec.checkId } : {}),
      },
    ),
    [projectId, setProject] = useState(
      e?.projectId ?? records.find((r) => r.kind === "project")?.id ?? "",
    ),
    [approve, setApprove] = useState(!e),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const task = records.find((r) => r.id === taskId),
    local = records.filter((r) => r.taskId === taskId && isCurrent(r));
  const update = (key: keyof Data, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));
  function select(
    label: string,
    key: keyof Data,
    values: string[],
    fallback: string,
  ) {
    return (
      <label>
        {label}
        <select
          value={String(data[key] ?? fallback)}
          disabled={Boolean(e && kind === "principle" && key === "scope")}
          onChange={(ev) => update(key, ev.target.value)}
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {labels[v] ?? v}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function checkbox(label: string, key: keyof Data, defaultValue: boolean) {
    return (
      <label className="checkbox">
        <input
          type="checkbox"
          checked={Boolean(data[key] ?? defaultValue)}
          onChange={(ev) => update(key, ev.target.checked)}
        />
        {label}
      </label>
    );
  }
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      let clean: Data = {};
      const fields: Record<Kind, (keyof Data)[]> = {
        project: ["tags"],
        task: ["type", "priority", "template", "codeRef", "tags"],
        requirement: ["priority", "groupId"],
        requirement_group: ["order"],
        criterion: ["requirementId", "applicable", "exclusionReason"],
        design: ["category", "required"],
        work_item: ["assignee", "required"],
        issue: ["severity", "blocking", "checkIds"],
        check: [
          "criterionIds",
          "type",
          "required",
          "preconditions",
          "steps",
          "expectedResult",
          "automationRef",
        ],
        result: [
          "checkId",
          "checkVersion",
          "criterionVersions",
          "requirementVersions",
          "codeRef",
          "outcome",
          "evidence",
          "environment",
        ],
        todo: ["type", "priority", "tags"],
        principle: ["scope", "strength", "category", "rationale"],
        question: ["blocking"],
      };
      for (const field of fields[kind])
        if (data[field] !== undefined)
          (clean as Record<string, unknown>)[field] = data[field];
      if (kind === "criterion")
        clean.requirementId =
          data.requirementId ??
          spec.requirementId ??
          local.find((r) => r.kind === "requirement")?.id;
      if (kind === "check") clean.criterionIds = data.criterionIds ?? [];
      if (kind === "result") {
        const check = local.find(
          (r) =>
            r.id ===
            (data.checkId ?? local.find((r) => r.kind === "check")?.id),
        );
        if (!check) throw new Error("请先创建测试用例");
        clean = {
          ...clean,
          checkId: check.id,
          checkVersion: check.version,
          criterionVersions: Object.fromEntries(
            (check.data.criterionIds ?? []).map((id) => [
              id,
              records.find((r) => r.id === id)!.version,
            ]),
          ),
          requirementVersions: Object.fromEntries(
            (check.data.criterionIds ?? [])
              .map((id) =>
                records.find(
                  (r) =>
                    r.id ===
                    records.find((c) => c.id === id)?.data.requirementId,
                )!,
              )
              .filter(Boolean)
              .map((r) => [r.id, r.version]),
          ),
          codeRef: task?.data.codeRef ?? "",
          outcome: data.outcome ?? "passed",
          evidence: data.evidence ?? body,
          environment: data.environment ?? "本机",
        };
      }
      if (kind === "principle") clean.scope = "task";
      const input = {
        kind,
        title,
        body,
        data: clean,
        taskId: taskId,
        projectId:
          kind === "task" || (kind === "todo" && !taskId)
            ? projectId || null
            : undefined,
        approve:
          approve &&
          ["requirement", "criterion", "design", "check", "principle"].includes(
            kind,
          ),
      };
      if (e) {
        const saved = await api<{ data: Entity }>("/api/v1/records/" + e.id, {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: e.version,
            title,
            body,
            data: clean,
          }),
        });
        if (input.approve)
          await post("/api/v1/records/" + e.id + "/approve", {
            expectedVersion: saved.data.version,
          });
      } else await post("/api/v1/records", input);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={(e ? "编辑" : "新建") + (labels[kind] ?? kind)}
      onClose={onClose}
      wide={kind === "design"}
    >
      <form onSubmit={save} className="editor">
        <label>
          标题
          <input
            required
            maxLength={200}
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            placeholder={
              kind === "todo"
                ? "此刻，你想到了什么？"
                : "给这项工作一个清晰的名字"
            }
          />
        </label>
        <label>
          {kind === "result" ? "验证说明" : "说明"}
          <textarea
            rows={kind === "design" ? 12 : 4}
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
            placeholder={
              kind === "design"
                ? "支持 Markdown：目标、方案、取舍、风险…"
                : "补充背景、想法或完成条件…"
            }
          />
        </label>
        <div className="form-grid">
          {(kind === "task" || (kind === "todo" && !taskId)) && (
            <label>
              项目
              <select
                value={projectId}
                disabled={Boolean(e)}
                onChange={(ev) => setProject(ev.target.value)}
              >
                {kind === "todo" && <option value="">不归属项目</option>}
                {records
                  .filter((r) => r.kind === "project")
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "todo" && !e && !spec.taskId && (
            <label>
              所属任务
              <select
                value={taskId ?? ""}
                onChange={(ev) => setTaskId(ev.target.value || undefined)}
              >
                <option value="">全局待办</option>
                {records
                  .filter(
                    (r) =>
                      r.kind === "task" &&
                      !["done", "cancelled"].includes(r.status),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.key} · {t.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "requirement" && (
            <label>
              需求分组
              <select
                value={data.groupId ?? ""}
                onChange={(ev) => update("groupId", ev.target.value || null)}
              >
                <option value="">未分组</option>
                {local
                  .filter((r) => r.kind === "requirement_group")
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "task" && (
            <>
              {select(
                "任务类型",
                "type",
                ["feature", "bug", "refactor", "research", "chore"],
                "feature",
              )}
              {select(
                "优先级",
                "priority",
                ["low", "medium", "high", "urgent"],
                "medium",
              )}
              <label>
                流程
                <select
                  value={data.template ?? "light"}
                  onChange={(ev) => update("template", ev.target.value)}
                >
                  <option value="light">轻量 · 小修复与改进</option>
                  <option value="standard">标准 · 完整功能</option>
                </select>
              </label>
              <label className="full">
                目标 commit SHA
                <input
                  value={data.codeRef ?? ""}
                  onChange={(ev) => update("codeRef", ev.target.value)}
                  placeholder="40 位完整提交 SHA，可稍后填写"
                />
              </label>
            </>
          )}
          {kind === "requirement" &&
            select("优先级", "priority", ["must", "should", "could"], "must")}
          {kind === "criterion" && (
            <label>
              所属需求
              <select
                value={
                  data.requirementId ??
                  spec.requirementId ??
                  local.find((r) => r.kind === "requirement")?.id ??
                  ""
                }
                onChange={(ev) => update("requirementId", ev.target.value)}
              >
                {local
                  .filter((r) => r.kind === "requirement")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "criterion" && (
            <>
              {checkbox("此验收标准适用于当前任务", "applicable", true)}
              {data.applicable === false && (
                <label className="full">
                  不适用的理由
                  <textarea
                    required
                    value={data.exclusionReason ?? ""}
                    onChange={(ev) =>
                      update("exclusionReason", ev.target.value)
                    }
                  />
                </label>
              )}
            </>
          )}
          {kind === "design" && (
            <>
              {select(
                "文档类型",
                "category",
                ["architecture", "module", "interface", "testing", "decision"],
                "architecture",
              )}
              {checkbox("本次验收必需的设计", "required", false)}
            </>
          )}
          {kind === "work_item" && (
            <>
              <label>
                执行者
                <input
                  value={data.assignee ?? ""}
                  onChange={(ev) => update("assignee", ev.target.value)}
                  placeholder="我 / 开发 Agent / 质量 Agent"
                />
              </label>
              {checkbox("本次验收必须完成", "required", true)}
            </>
          )}
          {kind === "issue" && (
            <>
              {select(
                "严重程度",
                "severity",
                ["low", "medium", "high", "critical"],
                "medium",
              )}
              {checkbox("阻塞最终验收", "blocking", false)}
            </>
          )}
          {kind === "question" &&
            checkbox("等待回答时阻塞验收", "blocking", false)}
          {kind === "principle" && (
            <>
              {select(
                "原则强度",
                "strength",
                ["recommended", "required"],
                "recommended",
              )}
              <label>
                分类
                <input
                  value={data.category ?? "架构"}
                  onChange={(ev) => update("category", ev.target.value)}
                />
              </label>
              <label>
                为什么要有这条原则
                <input
                  value={data.rationale ?? ""}
                  onChange={(ev) => update("rationale", ev.target.value)}
                />
              </label>
            </>
          )}
          {kind === "todo" && (
            <>
              {select("类型", "type", ["idea", "todo"], "idea")}
              {select(
                "优先级",
                "priority",
                ["low", "medium", "high"],
                "medium",
              )}
            </>
          )}
          {kind === "check" && (
            <>
              {select(
                "检查类型",
                "type",
                [
                  "unit",
                  "integration",
                  "concurrency",
                  "performance",
                  "manual",
                  "compatibility",
                ],
                "unit",
              )}
              {checkbox("必需检查", "required", true)}
              <fieldset className="full">
                <legend>关联验收标准</legend>
                {local
                  .filter(
                    (r) =>
                      r.kind === "criterion" &&
                      (data.criterionIds?.includes(r.id) ||
                        local.some((q) => q.id === r.data.requirementId)),
                  )
                  .map((c) => (
                    <label className="checkbox" key={c.id}>
                      <input
                        type="checkbox"
                        checked={data.criterionIds?.includes(c.id) ?? false}
                        onChange={(ev) =>
                          update(
                            "criterionIds",
                            ev.target.checked
                              ? [...(data.criterionIds ?? []), c.id]
                              : (data.criterionIds ?? []).filter(
                                  (id) => id !== c.id,
                                ),
                          )
                        }
                      />
                      {local.find((r) => r.id === c.data.requirementId)?.key ??
                        records.find((r) => r.id === c.data.requirementId)
                          ?.key}{" "}
                      ·{" "}
                      {
                        records.find((r) => r.id === c.data.requirementId)
                          ?.title
                      }{" "}
                      → {c.key} · {c.title}
                    </label>
                  ))}
                {!local.some((r) => r.kind === "criterion") && (
                  <p className="muted">请先在需求页添加验收标准。</p>
                )}
              </fieldset>
            </>
          )}
          {kind === "check" && (
            <>
              {(
                [
                  ["前置条件", "preconditions"],
                  ["执行步骤", "steps"],
                  ["预期结果", "expectedResult"],
                ] as const
              ).map(([label, key]) => (
                <label className="full" key={key}>
                  {label}
                  <textarea
                    rows={3}
                    value={String(data[key] ?? "")}
                    onChange={(ev) => update(key, ev.target.value)}
                  />
                </label>
              ))}
              <label className="full">
                自动化定位（文件 / 测试名称 / CI 链接）
                <input
                  value={data.automationRef ?? ""}
                  onChange={(ev) => update("automationRef", ev.target.value)}
                />
              </label>
            </>
          )}
          {kind === "issue" && (
            <fieldset className="full">
              <legend>关联测试用例</legend>
              {local
                .filter((r) => r.kind === "check")
                .map((c) => (
                  <label className="checkbox" key={c.id}>
                    <input
                      type="checkbox"
                      checked={data.checkIds?.includes(c.id) ?? false}
                      onChange={(ev) =>
                        update(
                          "checkIds",
                          ev.target.checked
                            ? [...(data.checkIds ?? []), c.id]
                            : (data.checkIds ?? []).filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.key} · {c.title}
                  </label>
                ))}
            </fieldset>
          )}
          {kind === "result" && (
            <>
              <label>
                测试用例
                <select
                  value={
                    data.checkId ??
                    local.find((r) => r.kind === "check")?.id ??
                    ""
                  }
                  onChange={(ev) => update("checkId", ev.target.value)}
                >
                  {local
                    .filter((r) => r.kind === "check")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </select>
              </label>
              {select(
                "执行结果",
                "outcome",
                ["passed", "failed", "blocked", "skipped", "error"],
                "passed",
              )}
              <label className="full">
                验证环境
                <input
                  value={data.environment ?? "本机"}
                  onChange={(ev) => update("environment", ev.target.value)}
                />
              </label>
              <label className="full">
                验证证据
                <textarea
                  required
                  rows={3}
                  value={data.evidence ?? ""}
                  onChange={(ev) => update("evidence", ev.target.value)}
                  placeholder="填写日志摘要、执行命令与结果，或报告链接"
                />
              </label>
              <p className="form-hint full">
                结果绑定当前需求、用例、验收标准版本和任务的目标
                commit。历史结果保留。
              </p>
            </>
          )}
        </div>
        {["requirement", "criterion", "design", "check", "principle"].includes(
          kind,
        ) && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={approve}
              onChange={(ev) => setApprove(ev.target.checked)}
            />
            保存并确认当前版本
          </label>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        <footer>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存
            {approve &&
            [
              "requirement",
              "criterion",
              "design",
              "check",
              "principle",
            ].includes(kind)
              ? "并确认"
              : ""}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function History({
  entity,
  onClose,
}: {
  entity: Entity;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ version: number; snapshot: Entity }[]>(
      [],
    ),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/v1/records/" + entity.id + "/revisions")
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.message));
  }, [entity.id]);
  const old = items[1]?.snapshot;
  const parts = diffLines(
    old ? old.title + "\n" + old.body : "",
    entity.title + "\n" + entity.body,
  );
  return (
    <Modal title="版本与变更" onClose={onClose} wide>
      <div className="modal-content">
        <div className="section-heading">
          <p>
            当前 v{entity.version} · {old ? "对比 v" + old.version : "首次创建"}
          </p>
          <Badge
            value={
              entity.approvedVersion === entity.version ? "passed" : "draft"
            }
          >
            {entity.approvedVersion === entity.version
              ? "当前版本已确认"
              : "当前版本待确认"}
          </Badge>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="diff">
          {parts.map((p, i) => (
            <pre
              key={i}
              className={p.added ? "added" : p.removed ? "removed" : ""}
            >
              {p.added ? "+ " : p.removed ? "− " : "  "}
              {p.value}
            </pre>
          ))}
        </div>
        <h3>历史版本</h3>
        {items.map((i) => (
          <details key={i.version}>
            <summary>
              版本 {i.version} · {i.snapshot.title}
            </summary>
            <Markdown text={i.snapshot.body} />
            <pre className="json-preview">
              {JSON.stringify(i.snapshot.data, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </Modal>
  );
}
