import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { labels, starKinds, reviewable, isCurrent } from "../shared/domain";
import { useHub, entityPath } from "./state";
import { CompactRow, RecordList } from "./compact";
import { Badge, Markdown } from "./components";
import { PageHeading } from "./pages";
import { StarButton } from "./stars";

export function StarredPage() {
  const { records, project } = useHub();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "all";
  const tasks = records.filter(
    (r) => r.kind === "task" && (project === "all" || r.projectId === project),
  );
  const selectedTask = params.get("taskId") ?? "all";
  const taskId =
    selectedTask === "global" || tasks.some((t) => t.id === selectedTask)
      ? selectedTask
      : "all";
  const byId = new Map(records.map((r) => [r.id, r]));
  const starred = records.filter(
    (r) => r.starred && (project === "all" || r.projectId === project),
  );
  const filtered = starred.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (taskId === "all" ||
        (taskId === "global" ? !r.taskId : r.taskId === taskId)),
  );
  function filter(key: string, value: string) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all") next.delete(key);
      else next.set(key, value);
      return next;
    });
  }
  return (
    <section className="starred-page">
      <PageHeading
        eyebrow="YOUR FOCUS"
        title="重点关注"
        description="把需要持续跟进的条目放在一起，随时回到原任务继续处理。"
      />
      <div className="starred-filters">
        <label>
          类型
          <select
            aria-label="关注类型"
            value={kind}
            onChange={(e) => filter("kind", e.target.value)}
          >
            <option value="all">全部类型</option>
            {starKinds.map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          任务
          <select
            aria-label="关注任务"
            value={taskId}
            onChange={(e) => filter("taskId", e.target.value)}
          >
            <option value="all">全部任务</option>
            <option value="global">全局待办</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.key} · {t.title}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small-text">
          已结束和移出范围的条目仍会保留，直到取消关注。
        </span>
      </div>
      <RecordList
        key={`${project}:${kind}:${taskId}`}
        records={filtered}
        empty={
          starred.length
            ? "没有符合筛选条件的关注项"
            : "暂无重点关注项，点击条目旁的星标即可加入"
        }
      >
        {(r) => {
          const task = r.taskId ? byId.get(r.taskId) : undefined;
          const parent =
            r.kind === "criterion"
              ? byId.get(r.data.requirementId ?? "")
              : undefined;
          return (
            <CompactRow
              record={r}
              meta={
                <>
                  <span className="starred-kind">{labels[r.kind]}</span>
                  <Link
                    className="starred-task"
                    to={task ? entityPath(task) : "/todos"}
                    title={task?.title ?? "全局待办"}
                  >
                    {task?.title ?? "全局待办"}
                  </Link>
                  {reviewable.includes(r.kind) && isCurrent(r) ? (
                    <Badge
                      value={
                        r.approvedVersion === r.version ? "passed" : "draft"
                      }
                    >
                      {r.approvedVersion === r.version ? "已确认" : "待确认"}
                    </Badge>
                  ) : (
                    <Badge
                      value={r.kind === "result" ? r.data.outcome : r.status}
                    />
                  )}
                  {parent &&
                    ["rejected", "deleted", "archived"].includes(
                      parent.status,
                    ) && (
                      <span className="muted small-text">
                        需求{labels[parent.status]}
                      </span>
                    )}
                  {task && ["done", "cancelled"].includes(task.status) && (
                    <span className="muted small-text">
                      任务{labels[task.status]}
                    </span>
                  )}
                </>
              }
              actions={
                <>
                  <StarButton record={r} />
                  <Link
                    className="icon-button"
                    to={entityPath(r)}
                    aria-label={"查看原条目" + r.title}
                    title="查看原条目"
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </>
              }
            >
              <Markdown text={r.body || "暂无详细说明。"} />
              <Link className="text-link" to={entityPath(r)}>
                查看原条目与关联内容 <ArrowUpRight size={13} />
              </Link>
            </CompactRow>
          );
        }}
      </RecordList>
    </section>
  );
}
