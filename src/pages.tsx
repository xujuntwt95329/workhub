import { TodosPanel } from "./task-lists";
import { RecordList } from "./compact";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Plus,
  ArrowRight,
  Check,
  Clock3,
  Layers,
  Lightbulb,
  ShieldCheck,
  Search,
  LayoutGrid,
  ListFilter,
  MoreHorizontal,
  Code2,
  GitBranch,
  CheckCheck,
  Compass,
  FileText,
  History as HistoryIcon,
  ChevronRight,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Archive,
  RotateCcw,
} from "lucide-react";
import {
  type Entity,
  evaluateMatrix,
  coverage,
  labels,
  isCurrent,
  currentWorkspaceRecords,
} from "../shared/domain";
import { useHub, entityPath } from "./state";
import { Badge, Button, Empty, History } from "./components";
import { api, post, percent, formatDate } from "./lib/api";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function TaskCard({ task }: { task: Entity }) {
  const { records } = useHub();
  const work = records.filter(
      (r) =>
        r.taskId === task.id &&
        r.kind === "work_item" &&
        r.status !== "cancelled",
    ),
    done = work.filter((r) => r.status === "done").length,
    ratio = work.length ? done / work.length : 0;
  const issues = records.filter(
    (r) =>
      r.taskId === task.id &&
      r.kind === "issue" &&
      r.data.blocking &&
      !["verified", "closed"].includes(r.status),
  );
  const designs = records.filter(
    (r) => r.taskId === task.id && r.kind === "design",
  );
  return (
    <Link to={"/tasks/" + task.id} className="task-card">
      <div className="task-card-top">
        <span className={"task-type type-" + task.data.type}>
          {task.data.type === "bug" ? (
            <ShieldCheck size={17} />
          ) : (
            <Layers size={17} />
          )}
        </span>
        <span className="mono">{task.key}</span>
        <Badge value={task.data.priority} />
        <ArrowUpRight className="card-arrow" size={17} />
      </div>
      <h3>{task.title}</h3>
      <p>{task.body || "让想法逐渐清晰，从需求开始。"}</p>
      <div className="tags">
        {(task.data.tags ?? []).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
        {!task.data.tags?.length && (
          <span>{labels[task.data.type ?? "feature"]}</span>
        )}
      </div>
      <div className="task-progress-label">
        <span>实施进度</span>
        <strong>{work.length ? `${done} / ${work.length}` : "尚未拆分"}</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: ratio * 100 + "%" }} />
      </div>
      <div className="task-card-footer">
        <Badge value={task.status} />
        <span>
          {issues.length ? (
            <>
              <span className="warning-dot" />
              {issues.length} 项阻塞
            </>
          ) : (
            <>
              <FileText size={13} />
              {designs.length} 份设计
            </>
          )}
        </span>
      </div>
    </Link>
  );
}
export function Dashboard() {
  const { records, project, edit, actor } = useHub();
  const tasks = records.filter(
      (r) =>
        r.kind === "task" && (project === "all" || r.projectId === project),
    ),
    active = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const taskIds = new Set(tasks.map((t) => t.id));
  const pending = currentWorkspaceRecords(records).filter(
    (r) =>
      isCurrent(r) &&
      ["design", "requirement", "check"].includes(r.kind) &&
      r.approvedVersion !== r.version &&
      r.taskId &&
      taskIds.has(r.taskId),
  );
  const todos = records.filter(
    (r) => r.kind === "todo" && r.status === "inbox",
  );
  const metrics = coverage(tasks.flatMap((t) => evaluateMatrix(t, records)));
  const issues = records.filter(
    (r) =>
      r.kind === "issue" &&
      r.data.blocking &&
      !["verified", "closed"].includes(r.status) &&
      taskIds.has(r.taskId!),
  );
  const focus = [...issues, ...pending].slice(0, 4);
  const today = new Date();
  return (
    <>
      <div className="welcome-line">
        <span>
          <span className="sun-symbol">☀</span> 你好，{actor.name}，很高兴见到你
        </span>
        <span>
          {today.toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">A LITTLE CLARITY, EVERY DAY</span>
          <h1>
            把想法变成进展<span>。</span>
          </h1>
          <p>
            清晰地思考，专注地创造。
            <br className="mobile-only" />
            今天，也让工作轻盈一点。
          </p>
          <div className="button-row">
            <Button onClick={() => edit({ kind: "task" })}>
              <Plus size={17} />
              创建任务
            </Button>
            <Button
              variant="hero-secondary"
              onClick={() => edit({ kind: "todo" })}
            >
              <Lightbulb size={17} />
              记下一个想法
            </Button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-spark">✦</div>
          <div className="art-window">
            <span className="art-window-dots">•••</span>
            <div className="art-code">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="art-check">
              <Check size={17} /> 一步一步，向前
            </div>
          </div>
          <div className="art-note">
            <Lightbulb size={22} />
            <span>
              Something
              <br />
              <b>worth building.</b>
            </span>
          </div>
          <div className="art-float">
            <GitBranch size={18} />
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <Stat
          icon={<Layers size={19} />}
          label="正在进行"
          value={active.length}
          note="让每项工作都有下一步"
          color="green"
        />
        <Stat
          icon={<Clock3 size={19} />}
          label="等待你确认"
          value={pending.length}
          note={pending.length ? "有新变化值得看一眼" : "一切井井有条"}
          color="amber"
        />
        <Stat
          icon={<Lightbulb size={19} />}
          label="待整理的想法"
          value={todos.length}
          note="灵感已经妥善收藏"
          color="purple"
        />
        <Stat
          icon={<ShieldCheck size={19} />}
          label="当前验证通过率"
          value={percent(metrics.passRate)}
          note={`${metrics.passed} / ${metrics.total} 条验收标准通过`}
          color="blue"
        />
      </div>
      <div className="dashboard-grid">
        <section>
          <div className="section-heading">
            <h2>
              正在推进 <span className="count-pill">{active.length}</span>
            </h2>
            <Link to="/tasks" className="text-link">
              查看全部 <ArrowRight size={15} />
            </Link>
          </div>
          {active.length ? (
            <div className="task-grid">
              {active.slice(0, 4).map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title="下一个值得实现的想法是什么？"
                action={
                  <Button onClick={() => edit({ kind: "task" })}>
                    <Plus size={15} />
                    创建第一个任务
                  </Button>
                }
              />
            </div>
          )}
          <div className="idea-strip">
            <div className="idea-strip-icon">
              <Lightbulb size={23} />
            </div>
            <div>
              <h3>灵感来时，不必打断专注。</h3>
              <p>先轻轻记下，留给未来的自己和 Agent。</p>
            </div>
            <button
              className="icon-button"
              aria-label="快速记下想法"
              onClick={() => edit({ kind: "todo" })}
            >
              <Plus size={21} />
            </button>
          </div>
        </section>
        <aside>
          <div className="section-heading">
            <h2>需要你的关注</h2>
            <Link className="icon-button" to="/reviews" aria-label="查看待处理">
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="attention-panel">
            {focus.length ? (
              focus.map((r) => (
                <Link to={entityPath(r)} className="attention-item" key={r.id}>
                  <span
                    className={
                      "attention-icon " +
                      (r.kind === "issue" ? "amber" : "purple")
                    }
                  >
                    {r.kind === "issue" ? (
                      <AlertCircle size={17} />
                    ) : (
                      <FileText size={17} />
                    )}
                  </span>
                  <div>
                    <small>
                      {r.kind === "issue" ? "阻塞问题" : "等待评审"} · {r.key}
                    </small>
                    <strong>{r.title}</strong>
                    <span>{records.find((t) => t.id === r.taskId)?.title}</span>
                  </div>
                  <ChevronRight size={15} />
                </Link>
              ))
            ) : (
              <div className="all-clear">
                <CheckCircle2 size={27} />
                <strong>暂时没有待处理事项</strong>
                <p>留点时间给深度工作。</p>
              </div>
            )}
            <Link to="/reviews" className="attention-footer">
              打开待我处理 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="assistant-teaser">
            <span className="spark-icon">
              <Sparkles size={21} />
            </span>
            <span className="eyebrow">YOUR THINKING PARTNER</span>
            <h3>
              把复杂的事，
              <br />
              聊清楚。
            </h3>
            <p>
              问问任务进展、设计取舍，
              <br />
              或一起找到下一步。
            </p>
            <Link to="/assistant" className="text-link">
              打开智能助手 <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
function Stat({
  icon,
  label,
  value,
  note,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  note: string;
  color: string;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className={"stat-icon " + color}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Tasks() {
  const { records, project, edit } = useHub();
  const [status, setStatus] = useState("all");
  const tasks = records.filter(
    (r) =>
      r.kind === "task" &&
      (project === "all" || r.projectId === project) &&
      (status === "all" ||
        (status === "active"
          ? !["done", "cancelled"].includes(r.status)
          : r.status === status)),
  );
  return (
    <>
      <PageHeading
        eyebrow="MAKE THINGS HAPPEN"
        title="每项工作，都有自己的空间。"
        description="从一个小修复到一次大迭代，让进展清晰可见。"
        action={
          <Button onClick={() => edit({ kind: "task" })}>
            <Plus size={17} />
            创建任务
          </Button>
        }
      />
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "全部任务"],
            ["active", "进行中"],
            ["done", "已完成"],
            ["cancelled", "已取消"],
          ].map(([v, l]) => (
            <button
              className={status === v ? "selected" : ""}
              onClick={() => setStatus(v)}
              key={v}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {tasks.length ? (
        <div className="dense-tasks">
          <RecordList records={tasks}>
            {(t) => <TaskCard task={t} />}
          </RecordList>
        </div>
      ) : (
        <Empty
          title="这里还没有任务"
          action={
            <Button onClick={() => edit({ kind: "task" })}>创建任务</Button>
          }
        />
      )}
    </>
  );
}
export function Todos() {
  return <TodosPanel />;
}
export function Reviews() {
  const { records, act } = useHub();
  const [history, setHistory] = useState<Entity>();
  const pending = currentWorkspaceRecords(records).filter(
    (r) =>
      ["requirement", "criterion", "design", "check", "principle"].includes(
        r.kind,
      ) &&
      isCurrent(r) &&
      (r.kind !== "criterion" ||
        records.some((q) => q.id === r.data.requirementId && isCurrent(q))) &&
      r.approvedVersion !== r.version,
  );
  const blockers = records.filter(
    (r) =>
      r.data.blocking &&
      !["resolved", "verified", "closed", "archived"].includes(r.status),
  );
  return (
    <>
      <PageHeading
        eyebrow="YOUR JUDGMENT MATTERS"
        title="值得你看一眼的变化。"
        description="看清差异，作出决定，让工作继续向前。"
      />
      <div className="panel">
        <div className="panel-heading">
          <h2>待确认的内容</h2>
          <span className="count-pill">{pending.length}</span>
        </div>
        <RecordList records={pending}>
          {(r) => (
            <div className="review-row" key={r.id}>
              <div className="item-icon purple">
                <FileText size={19} />
              </div>
              <div className="grow">
                <span className="mono">
                  {r.key} · v{r.version}
                </span>
                <Link to={entityPath(r)}>
                  <h3>{r.title}</h3>
                </Link>
                <small className="muted">
                  {labels[r.kind]} ·{" "}
                  {records.find((t) => t.id === r.taskId)?.title ?? "基本原则"}
                </small>
              </div>
              <Button variant="secondary small" onClick={() => setHistory(r)}>
                查看差异
              </Button>
              <Button
                variant="small"
                onClick={() =>
                  void act(
                    () =>
                      post("/api/v1/records/" + r.id + "/approve", {
                        expectedVersion: r.version,
                      }),
                    "当前版本已确认",
                  )
                }
              >
                <Check size={15} />
                确认
              </Button>
            </div>
          )}
        </RecordList>
        {!pending.length && (
          <Empty
            title="所有变化都已确认"
            description="有新的提交时，会出现在这里。"
          />
        )}
      </div>
      {blockers.length > 0 && (
        <div className="panel top-space">
          <div className="panel-heading">
            <h2>阻塞与待决问题</h2>
          </div>
          <RecordList records={blockers}>
            {(r) => (
              <Link className="review-row" key={r.id} to={entityPath(r)}>
                <AlertCircle className="amber-text" size={20} />
                <div className="grow">
                  <h3>{r.title}</h3>
                  <span className="muted">{r.key}</span>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            )}
          </RecordList>
        </div>
      )}
      {history && (
        <History entity={history} onClose={() => setHistory(undefined)} />
      )}
    </>
  );
}
