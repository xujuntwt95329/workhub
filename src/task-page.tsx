import {
  RequirementsPanel,
  TestCasesPanel,
  TaskRecordsPanel,
  TodosPanel,
} from "./task-lists";
import { useList } from "./compact";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Plus,
  Check,
  Clock3,
  FileText,
  GitBranch,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  History as HistoryIcon,
  Pencil,
  ChevronRight,
  Download,
  Save,
  Compass,
  CheckCircle2,
  Layers,
} from "lucide-react";
import {
  type Entity,
  type Kind,
  type MatrixRow,
  evaluateMatrix,
  coverage,
  completionGaps,
  labels,
  availableTransitions,
} from "../shared/domain";
import { useHub, entityPath } from "./state";
import { Badge, Button, Empty, History, Markdown, Modal } from "./components";
import { api, post, percent, formatDate } from "./lib/api";
import { PageHeading } from "./pages";
export function TaskPage() {
  const { id } = useParams(),
    { records, edit, act } = useHub();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const task = records.find((r) => r.id === id && r.kind === "task");
  const [accepting, setAccepting] = useState(false),
    [events, setEvents] = useState<any[]>([]),
    [summary, setSummary] = useState<any>(null);
  const [principleReview, setPrincipleReview] = useState<Entity>(),
    [principleNote, setPrincipleNote] = useState("");
  useEffect(() => {
    if (!id) return;
    api("/api/v1/events")
      .then((r) =>
        setEvents(r.items.filter((e: any) => e.task_id === id).reverse()),
      )
      .catch(() => {});
    api("/api/tasks/" + id + "/summary")
      .then((r) => setSummary(r.data))
      .catch(() => {});
  }, [id, records]);
  if (!task)
    return (
      <Empty
        title="任务不存在或尚未加载"
        action={<Link to="/tasks">返回任务列表</Link>}
      />
    );
  const local = records.filter(
      (r) =>
        r.taskId === id &&
        !["archived", "rejected", "deleted"].includes(r.status),
    ),
    by = (kind: Kind) => local.filter((r) => r.kind === kind);
  const rows = evaluateMatrix(task, records),
    metrics = coverage(rows),
    gaps = completionGaps(task, records);
  const readonly = ["done", "cancelled"].includes(task.status);
  const tabs = [
    ["overview", "概览"],
    ["requirements", "需求", by("requirement").length],
    ["designs", "设计", by("design").length],
    ["work", "实施", by("work_item").length],
    ["issues", "问题", by("issue").length + by("question").length],
    ["tests", "测试用例", by("check").length],
    ["quality", "质量"],
    ["todos", "待办", by("todo").length],
    ["principles", "基本原则", by("principle").length],
    ["activity", "活动"],
  ] as const;
  const transition = (r: Entity, status: string) =>
    void act(
      () =>
        post("/api/v1/records/" + r.id + "/transitions", {
          expectedVersion: r.version,
          status,
        }),
      "状态已更新",
    );
  return (
    <>
      <Link className="back-link" to="/tasks">
        <ArrowLeft size={15} />
        所有任务
      </Link>
      <div className="task-heading">
        <div>
          <div className="badge-row">
            <span className="mono">{task.key}</span>
            <Badge value={task.data.type} />
            <Badge value={task.data.priority} />
            <Badge value={task.status} />
          </div>
          <h1>{task.title}</h1>
          <span className="muted">
            {records.find((p) => p.id === task.projectId)?.title}{" "}
            <span className="dot-separator">·</span>
            {task.data.template === "standard"
              ? "标准工程流程"
              : "轻量工作流程"}
          </span>
        </div>
        <div className="button-row">
          <Link className="button secondary" to={"/assistant?task=" + task.id}>
            <Sparkles size={16} />
            询问此任务
          </Link>
          {!readonly && (
            <select
              aria-label="变更任务状态"
              value=""
              onChange={(e) => transition(task, e.target.value)}
            >
              <option disabled value="">
                变更状态
              </option>
              {availableTransitions(task).map((next) => (
                <option key={next} value={next}>
                  {labels[next]}
                </option>
              ))}
            </select>
          )}
          {!readonly && (
            <Button
              variant="secondary"
              onClick={() => edit({ kind: "task", entity: task })}
            >
              <Pencil size={15} />
              编辑
            </Button>
          )}
          {task.status === "draft" ? (
            <Button onClick={() => transition(task, "active")}>
              开始任务 <ArrowUpRight size={15} />
            </Button>
          ) : readonly ? (
            <Button
              variant="secondary"
              onClick={() => transition(task, "active")}
            >
              重新打开
            </Button>
          ) : (
            <Button onClick={() => setAccepting(true)}>
              <CheckCheckIcon />
              提交验收
            </Button>
          )}
        </div>
      </div>
      <div className="task-tabs">
        {tabs.map(([value, label, count]) => (
          <button
            key={value}
            className={tab === value ? "selected" : ""}
            onClick={() => setParams({ tab: value })}
          >
            {label}
            {count !== undefined && <span>{count}</span>}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="detail-grid">
          <div>
            <div className="panel detail-panel">
              <div className="panel-heading">
                <h2>目标与范围</h2>
                <span className="mono">THE BIG PICTURE</span>
              </div>
              <Markdown
                text={task.body || "写下目标与边界，让每一步都有方向。"}
              />
              <div className="code-reference">
                <GitBranch size={16} />
                <span>验证目标</span>
                <code>
                  {task.data.codeRef
                    ? task.data.codeRef.slice(0, 12)
                    : "尚未登记 commit SHA"}
                </code>
                {!readonly && (
                  <button
                    className="text-button"
                    onClick={() => edit({ kind: "task", entity: task })}
                  >
                    设置
                  </button>
                )}
              </div>
            </div>
            <div className="overview-stats">
              {[
                [
                  "需求已确认",
                  by("requirement").filter(
                    (r) => r.approvedVersion === r.version,
                  ).length,
                  by("requirement").length,
                ],
                [
                  "设计已确认",
                  by("design").filter((r) => r.approvedVersion === r.version)
                    .length,
                  by("design").length,
                ],
                [
                  "实施已完成",
                  by("work_item").filter((r) => r.status === "done").length,
                  by("work_item").length,
                ],
                ["当前验收通过", metrics.passed, metrics.total],
              ].map(([label, n, total]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {n}
                    <small> / {total}</small>
                  </strong>
                  <div className="progress-track">
                    <i
                      style={{
                        width:
                          (Number(total)
                            ? (Number(n) / Number(total)) * 100
                            : 0) + "%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="panel detail-panel">
              <div className="panel-heading">
                <h2>
                  <Sparkles size={18} />
                  智能概览
                </h2>
                <button
                  className="text-button"
                  onClick={() =>
                    void act(
                      () =>
                        post("/api/assistant/runs", {
                          question: "总结此任务",
                          taskId: task.id,
                          summary: true,
                        }),
                      "概览已加入生成队列",
                    )
                  }
                >
                  重新生成
                </button>
              </div>
              {summary ? (
                <>
                  <div className="badge-row">
                    <Badge value={summary.stale ? "stale" : "passed"}>
                      {summary.stale ? "内容变化，待更新" : "与当前数据一致"}
                    </Badge>
                    <small className="muted">
                      {formatDate(summary.finished_at ?? summary.created_at)}
                    </small>
                  </div>
                  <Markdown
                    text={String(summary.answer).replace(
                      /\]\(workhub:[^)]+\)/g,
                      "]",
                    )}
                  />
                </>
              ) : (
                <div className="summary-placeholder">
                  <Sparkles size={24} />
                  <p>让助手帮你整理进展、阻塞和下一步。</p>
                  <Link to="/settings" className="text-link">
                    配置模型后启用 <ArrowUpRight size={14} />
                  </Link>
                </div>
              )}
            </div>
            <div className="panel detail-panel">
              <div className="panel-heading">
                <h2>最近活动</h2>
                <button
                  className="text-button"
                  onClick={() => setParams({ tab: "activity" })}
                >
                  查看全部
                </button>
              </div>
              <Activity events={events.slice(0, 4)} compact />
            </div>
          </div>
          <aside>
            <div className="panel detail-panel">
              <div className="panel-heading">
                <h2>验收检查</h2>
                <Badge value={gaps.length ? "blocked" : "passed"}>
                  {gaps.length ? "仍有缺口" : "准备就绪"}
                </Badge>
              </div>
              {gaps.length ? (
                <ul className="gap-list">
                  {gaps.map((g) => (
                    <li key={g}>
                      <span />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="all-clear">
                  <CheckCircle2 size={28} />
                  <p>当前版本已满足验收条件。</p>
                </div>
              )}
              <button
                className="text-link"
                onClick={() => setParams({ tab: "quality" })}
              >
                查看质量矩阵 <ArrowRightIcon />
              </button>
            </div>
            <div className="panel detail-panel">
              <div className="panel-heading">
                <h2>
                  <Compass size={17} />
                  适用原则
                </h2>
              </div>
              {(task.data.principles ?? []).map((p) => {
                const principle = records.find((r) => r.id === p.id);
                return (
                  <div className="principle-mini" key={p.id}>
                    <Link to={"/tasks/" + id + "?tab=principles&focus=" + p.id}>
                      {principle?.title ?? p.id}
                    </Link>
                    <small>
                      v{p.version}
                      {principle?.approvedVersion !== p.version
                        ? " · 有更新"
                        : ""}
                    </small>
                    {!readonly && p.strength === "required" && (
                      <button
                        className="text-button green-text"
                        onClick={() =>
                          void act(async () => {
                            const revisions = await api<{
                              data: { snapshot: Entity; version: number }[];
                            }>("/api/v1/records/" + p.id + "/revisions");
                            setPrincipleReview(
                              revisions.data.find(
                                (r) => r.version === p.version,
                              )?.snapshot,
                            );
                            setPrincipleNote("");
                            return true;
                          }, "已打开采用的原则版本")
                        }
                      >
                        {task.data.principleChecks?.some(
                          (c) =>
                            c.id === p.id &&
                            c.version === p.version &&
                            c.codeRef === task.data.codeRef,
                        )
                          ? "已核对"
                          : "核对"}
                      </button>
                    )}
                  </div>
                );
              })}
              {!task.data.principles?.length && (
                <p className="muted">暂无已采用原则</p>
              )}
              {!readonly && (
                <div className="button-row">
                  <button
                    className="text-link"
                    onClick={() =>
                      void act(
                        () =>
                          post(
                            "/api/v1/tasks/" + task.id + "/principle-adoptions",
                            { expectedVersion: task.version },
                          ),
                        "已采用当前有效原则",
                      )
                    }
                  >
                    采用最新原则 <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => edit({ kind: "principle", taskId: task.id })}
                  >
                    <Plus size={14} />
                    任务原则
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      {tab === "requirements" && (
        <RequirementsPanel key={task.id} task={task} />
      )}
      {tab === "tests" && <TestCasesPanel key={task.id} task={task} />}
      {tab === "todos" && <TodosPanel key={task.id} task={task} />}
      {tab === "principles" && (
        <TaskRecordsPanel task={task} kind="principle" />
      )}
      {tab === "designs" && <TaskRecordsPanel task={task} kind="design" />}
      {tab === "work" && <TaskRecordsPanel task={task} kind="work_item" />}
      {tab === "issues" && <TaskRecordsPanel task={task} kind="issue" />}
      {tab === "quality" && (
        <>
          <div className="section-heading">
            <div>
              <h2>质量与追溯矩阵</h2>
              <p className="muted">
                证据绑定需求、验收标准、用例版本和目标
                commit；内容变化后需复验。
              </p>
            </div>
            <Link
              className="button secondary small"
              to={"/tasks/" + id + "?tab=tests"}
            >
              管理测试用例
            </Link>
          </div>
          <Matrix rows={rows} />
          <TaskRecordsPanel task={task} kind="result" />
        </>
      )}
      {tab === "activity" && (
        <div className="panel detail-panel">
          <h2>每一步，都有迹可循</h2>
          <Activity events={events} />
        </div>
      )}
      {principleReview && (
        <Modal
          title="核对采用的原则"
          onClose={() => setPrincipleReview(undefined)}
        >
          <form
            className="editor"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act(
                () =>
                  post("/api/v1/tasks/" + task.id + "/principle-checks", {
                    expectedVersion: task.version,
                    principleId: principleReview.id,
                    note: principleNote,
                  }),
                "原则核对已记录",
              );
              if (result) setPrincipleReview(undefined);
            }}
          >
            <h3>
              {principleReview.title} · v{principleReview.version}
            </h3>
            <Markdown text={principleReview.body} />
            <p className="muted">
              核对记录绑定当前目标 commit
              SHA；代码或原则版本变化后需要重新核对。
            </p>
            <label>
              核对依据
              <textarea
                required
                maxLength={2000}
                value={principleNote}
                onChange={(e) => setPrincipleNote(e.target.value)}
                placeholder="说明实现如何符合原则，以及对应的证据。"
              />
            </label>
            <Button
              type="submit"
              disabled={!task.data.codeRef || !principleNote.trim()}
            >
              确认符合原则
            </Button>
            {!task.data.codeRef && (
              <p className="error-text">请先编辑任务，登记目标 commit SHA。</p>
            )}
          </form>
        </Modal>
      )}
      {accepting && (
        <Modal title="确认本次工程验收" onClose={() => setAccepting(false)}>
          <div className="modal-content">
            <p>系统将保存需求、质量证据与目标代码的报告快照。</p>
            {gaps.length ? (
              <>
                <div className="error-box">
                  还有 {gaps.length} 项条件需要处理
                </div>
                <ul className="gap-list">
                  {gaps.map((g) => (
                    <li key={g}>
                      <span />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="success-box">当前版本已满足所有验收条件。</div>
            )}
            <div className="button-row end">
              <Button variant="secondary" onClick={() => setAccepting(false)}>
                返回
              </Button>
              <Button
                disabled={gaps.length > 0}
                onClick={async () => {
                  const r = await act(
                    () =>
                      post("/api/v1/tasks/" + task.id + "/acceptances", {
                        expectedVersion: task.version,
                      }),
                    "任务已验收，报告快照已保存",
                  );
                  if (r) setAccepting(false);
                }}
              >
                确认验收
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function CheckCheckIcon() {
  return <CheckCircle2 size={16} />;
}
function ArrowRightIcon() {
  return <ChevronRight size={14} />;
}
function Activity({
  events,
  compact = false,
}: {
  events: any[];
  compact?: boolean;
}) {
  const list = useList(events, (e) => e.title + " " + e.action);
  return (
    <div className="activity-list">
      {!compact && list.controls}
      {list.items.map((e) => (
        <div className="activity-item" key={e.id}>
          <span className="activity-dot" />
          <div>
            <strong>
              {({
                created: "创建了",
                updated: "更新了",
                approved: "确认了",
                transitioned: "更新了状态",
                review_requested: "提交了评审",
                accepted: "完成了验收",
                principles_adopted: "更新了原则",
                principle_checked: "核对了原则",
                requirement_reject: "拒绝了需求",
                requirement_delete: "删除了需求",
                requirement_restore: "恢复了需求",
                todo_assigned: "调整了待办归属",
                principle_migrated: "迁移了原则",
                task_principles_migrated: "迁移了任务原则",
              }[e.action as string] ?? e.action) +
                " " +
                e.title}
            </strong>
            <small>{formatDate(e.created_at)}</small>
          </div>
        </div>
      ))}
      {!events.length && <p className="muted">任务的变化会记录在这里。</p>}
    </div>
  );
}
export function Matrix({ rows }: { rows: MatrixRow[] }) {
  const m = coverage(rows);
  const list = useList(rows, (row) =>
    [
      row.requirement?.title,
      row.requirement?.key,
      row.criterion.key,
      row.criterion.title,
      ...row.checks.map((c) => c.check.key + " " + c.check.title),
    ].join(" "),
  );
  return (
    <>
      <div className="matrix-stats">
        <div>
          <span>检查关联</span>
          <strong>
            {m.linked}
            <small> / {m.total}</small>
          </strong>
        </div>
        <div>
          <span>当前执行覆盖</span>
          <strong>
            {m.executed}
            <small> / {m.total}</small>
          </strong>
        </div>
        <div>
          <span>当前验证通过</span>
          <strong className="green-text">{percent(m.passRate)}</strong>
        </div>
        <div>
          <span>豁免 / 不适用</span>
          <strong>
            {m.waived}
            <small> / {m.notApplicable}</small>
          </strong>
        </div>
      </div>
      {list.controls}
      <div className="panel table-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>需求 / 验收标准</th>
              <th>检查计划</th>
              <th>当前证据</th>
              <th>验收结论</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.criterion.id}>
                <td>
                  <small>
                    {row.requirement && (
                      <Link to={entityPath(row.requirement)}>
                        {row.requirement.key} · {row.requirement.title}
                      </Link>
                    )}
                  </small>
                  <strong>
                    <Link to={entityPath(row.criterion)}>
                      {row.criterion.title}
                    </Link>
                  </strong>
                  <span className="mono">
                    {row.criterion.key} · v{row.criterion.version}
                  </span>
                </td>
                <td>
                  {row.checks.length ? (
                    row.checks.map((c) => (
                      <div className="matrix-cell-line" key={c.check.id}>
                        <ShieldCheck size={13} />
                        <Link to={entityPath(c.check)}>
                          {c.check.key} · {c.check.title}
                        </Link>
                      </div>
                    ))
                  ) : (
                    <span className="muted">尚未关联检查</span>
                  )}
                </td>
                <td>
                  {row.checks.map((c) => (
                    <div key={c.check.id} className="matrix-cell-line">
                      <Badge value={c.state} />
                      {c.result && (
                        <Link to={entityPath(c.result)}>
                          {c.result.key} · {c.result.data.codeRef?.slice(0, 7)}
                        </Link>
                      )}
                    </div>
                  ))}
                </td>
                <td>
                  <Badge value={row.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            title="还没有可以追踪的验收标准"
            description="添加需求和验收标准后，这里会自动生成覆盖矩阵。"
          />
        )}
      </div>
      <p className="matrix-footnote">
        按验收标准去重统计。豁免不计为通过，不适用从分母排除；关联检查不代表已经通过验证。
      </p>
    </>
  );
}
export function ReportsPage() {
  const { records, project, act } = useHub();
  const tasks = records.filter(
    (r) => r.kind === "task" && (project === "all" || r.projectId === project),
  );
  const [selection, setSelection] = useState(""),
    [snapshots, setSnapshots] = useState<any[]>([]),
    [view, setView] = useState<any>();
  const snapshotList = useList(
    snapshots,
    (s) => s.kind + " " + formatDate(s.created_at),
  );
  const task = tasks.find((t) => t.id === selection) ?? tasks[0];
  const rows = task ? evaluateMatrix(task, records) : [];
  useEffect(() => {
    if (task)
      api("/api/v1/tasks/" + task.id + "/reports")
        .then((r) => setSnapshots(r.data))
        .catch(() => {});
  }, [task?.id, records]);
  return (
    <>
      <PageHeading
        eyebrow="EVIDENCE, NOT GUESSWORK"
        title="看见全貌，也看清缺口。"
        description="从需求到验证，每个结论都有依据。报表随工程数据自动更新。"
        action={
          task && (
            <div className="button-row">
              <a
                className="button secondary"
                href={"/api/v1/tasks/" + task.id + "/export?format=csv"}
                download
              >
                <Download size={16} />
                导出 CSV
              </a>
              <Button
                onClick={() =>
                  void act(
                    () =>
                      post(
                        "/api/v1/tasks/" + task.id + "/report-snapshots",
                        {},
                      ),
                    "报告快照已保存",
                  )
                }
              >
                <Save size={16} />
                保存快照
              </Button>
            </div>
          )
        }
      />
      <div className="toolbar">
        <div className="report-selector">
          <Layers size={18} />
          <select
            aria-label="报告任务"
            value={task?.id ?? ""}
            onChange={(e) => setSelection(e.target.value)}
          >
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <span className="status-text green-text">
          <span className="tiny-dot" />
          当前工程数据
        </span>
      </div>
      <Matrix rows={rows} />
      {snapshots.length > 0 && (
        <div className="panel top-space">
          <div className="panel-heading">
            <h2>历史报告快照</h2>
            <span className="muted small-text">
              固定当时的范围、证据和统计口径
            </span>
          </div>
          {snapshotList.controls}
          {snapshotList.items.map((s) => (
            <button
              className="snapshot-row"
              key={s.id}
              onClick={() =>
                void act(async () => {
                  const r = await api("/api/v1/report-snapshots/" + s.id);
                  setView(r.data);
                  return true;
                }, "已打开历史快照")
              }
            >
              <FileText size={18} />
              <span>
                {s.kind === "acceptance" ? "最终验收报告" : "质量覆盖报告"}
              </span>
              <span className="muted">{formatDate(s.created_at)}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
      {view && (
        <Modal title="历史报告快照" wide onClose={() => setView(undefined)}>
          <div className="modal-content">
            <p className="muted">
              {view.task.title} · {formatDate(view.asOf)}
            </p>
            <Matrix rows={view.rows} />
          </div>
        </Modal>
      )}
    </>
  );
}
