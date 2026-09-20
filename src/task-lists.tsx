import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  Pencil,
  History as HistoryIcon,
  Check,
  Trash2,
  FolderPlus,
  Undo2,
  X,
} from "lucide-react";
import {
  type Entity,
  type Kind,
  isCurrent,
  labels,
  availableTransitions,
} from "../shared/domain";
import { traceability } from "../shared/traceability";
import { useHub, entityPath } from "./state";
import { Badge, Button, Empty, History, Markdown, Modal } from "./components";
import { CompactRow, RecordList, useList } from "./compact";
import { post, formatDate } from "./lib/api";
import { StarButton } from "./stars";

function Confirmed({ record: r }: { record: Entity }) {
  return (
    <Badge value={r.approvedVersion === r.version ? "passed" : "draft"}>
      {r.approvedVersion === r.version ? "已确认" : "待确认"}
    </Badge>
  );
}
function Actions({
  record: r,
  readonly = false,
}: {
  record: Entity;
  readonly?: boolean;
}) {
  const { act, edit } = useHub(),
    [history, setHistory] = useState(false);
  return (
    <>
      <StarButton record={r} />
      <button
        className="icon-button"
        aria-label={"查看" + r.title + "版本"}
        onClick={() => setHistory(true)}
      >
        <HistoryIcon size={14} />
      </button>
      {!readonly && isCurrent(r) && (
        <>
          <button
            className="icon-button"
            aria-label={"编辑" + r.title}
            onClick={() => edit({ kind: r.kind, entity: r })}
          >
            <Pencil size={14} />
          </button>
          {[
            "requirement",
            "criterion",
            "check",
            "design",
            "principle",
          ].includes(r.kind) &&
            r.approvedVersion !== r.version && (
              <button
                className="icon-button green-text"
                aria-label={"确认" + r.title}
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
              </button>
            )}
        </>
      )}
      {history && <History entity={r} onClose={() => setHistory(false)} />}
    </>
  );
}
export function RequirementsPanel({ task }: { task: Entity }) {
  const { records, edit, act } = useHub(),
    [params] = useSearchParams();
  const local = records.filter((r) => r.taskId === task.id),
    all = local.filter((r) => r.kind === "requirement");
  const [view, setView] = useState("active"),
    [group, setGroup] = useState("all"),
    [expanded, setExpanded] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const [disposition, setDisposition] = useState<{
      record: Entity;
      action: "reject" | "delete";
    }>(),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const focus = local.find((r) => r.id === params.get("focus")),
    focusReq =
      focus?.kind === "criterion"
        ? local.find((r) => r.id === focus.data.requirementId)
        : focus;
  useEffect(() => {
    if (focusReq?.kind === "requirement") {
      setView(isCurrent(focusReq) ? "active" : focusReq.status);
      setGroup("all");
      setCollapsed([]);
    }
  }, [focusReq?.id]);
  const groups = local
    .filter((r) => r.kind === "requirement_group" && isCurrent(r))
    .sort(
      (a, b) =>
        (a.data.order ?? 0) - (b.data.order ?? 0) || a.sequence - b.sequence,
    );
  const filtered = all.filter(
    (r) =>
      (view === "active" ? isCurrent(r) : r.status === view) &&
      (group === "all" || (r.data.groupId ?? "ungrouped") === group),
  );
  const list = useList(
    filtered,
    (r) =>
      [
        r.key,
        r.title,
        r.body,
        ...local
          .filter((c) => c.data.requirementId === r.id)
          .map((c) => c.key + " " + c.title),
      ].join(" "),
    focusReq?.id,
    (r) => r.id,
  );
  const graph = traceability(task, records),
    readonly = ["done", "cancelled"].includes(task.status);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!disposition) return;
    setBusy(true);
    const result = await act(
      () =>
        post(
          "/api/v1/requirements/" +
            disposition.record.id +
            "/" +
            disposition.action,
          { expectedVersion: disposition.record.version, reason },
        ),
      disposition.action === "reject" ? "已移入拒绝列表" : "已移入回收站",
    );
    setBusy(false);
    if (result) {
      setDisposition(undefined);
      setReason("");
    }
  }
  const groupList = [
    ...groups.map((g) => ({ id: g.id, title: g.title, record: g })),
    { id: "ungrouped", title: "未分组", record: undefined },
  ];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>需求与验收标准</h2>
          <p className="muted">
            展开查看标准与测试证据；拒绝和删除保留完整追溯记录。
          </p>
        </div>
        {!readonly && (
          <div className="button-row">
            <Button
              variant="secondary small"
              onClick={() =>
                edit({ kind: "requirement_group", taskId: task.id })
              }
            >
              <FolderPlus size={15} />
              新建分组
            </Button>
            <Button
              variant="small"
              onClick={() =>
                edit({
                  kind: "requirement",
                  taskId: task.id,
                  ...(group !== "all" && group !== "ungrouped"
                    ? { groupId: group }
                    : {}),
                })
              }
            >
              <Plus size={15} />
              添加需求
            </Button>
          </div>
        )}
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["active", "当前需求"],
            ["rejected", "拒绝列表"],
            ["deleted", "回收站"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={view === v ? "selected" : ""}
              onClick={() => setView(v)}
            >
              {l}{" "}
              <span>
                {
                  all.filter((r) =>
                    v === "active" ? isCurrent(r) : r.status === v,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="button-row">
          <select
            aria-label="筛选需求分组"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">全部分组</option>
            {groupList.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button
            className="text-button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "全部收起" : "全部展开"}
          </button>
        </div>
      </div>
      {list.controls}
      <div className="compact-list">
        {groupList
          .filter((g) => group === "all" || group === g.id)
          .map((g) => {
            const pageRows = list.items.filter(
              (r) => (r.data.groupId ?? "ungrouped") === g.id,
            );
            if (
              !pageRows.length &&
              (group === "all" || !g.record || view !== "active")
            )
              return null;
            return (
              <section className="requirement-group" key={g.id}>
                <div className="group-heading">
                  <button
                    className="text-button"
                    aria-expanded={!collapsed.includes(g.id)}
                    onClick={() =>
                      setCollapsed((prev) =>
                        prev.includes(g.id)
                          ? prev.filter((id) => id !== g.id)
                          : [...prev, g.id],
                      )
                    }
                  >
                    {collapsed.includes(g.id) ? "▸" : "▾"} {g.title}
                    <span className="count-pill">
                      {
                        filtered.filter(
                          (r) => (r.data.groupId ?? "ungrouped") === g.id,
                        ).length
                      }
                    </span>
                  </button>
                  {g.record && !readonly && (
                    <div className="row-actions">
                      <Actions record={g.record} />
                      <button
                        className="icon-button"
                        aria-label={"删除分组" + g.title}
                        onClick={() =>
                          void act(
                            () =>
                              post("/api/v1/records/" + g.id + "/archive", {
                                expectedVersion: g.record!.version,
                              }),
                            "空分组已移除",
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {!collapsed.includes(g.id) &&
                  pageRows.map((r) => {
                    const criteria = local.filter(
                      (c) =>
                        c.kind === "criterion" &&
                        c.data.requirementId === r.id &&
                        isCurrent(c),
                    );
                    const cases = graph.cases.filter((c) =>
                      c.links.some((l) => l.requirement?.id === r.id),
                    );
                    return (
                      <CompactRow
                        key={r.id}
                        record={r}
                        forceOpen={expanded}
                        focused={focusReq?.id === r.id}
                        meta={
                          <>
                            <Badge value={r.data.priority} />
                            {isCurrent(r) ? (
                              <Confirmed record={r} />
                            ) : (
                              <Badge value={r.status} />
                            )}
                            <span className="muted small-text">
                              {criteria.length} 标准 · {cases.length} 用例
                            </span>
                          </>
                        }
                        actions={
                          <>
                            <Actions record={r} readonly={readonly} />
                            {!readonly &&
                              (isCurrent(r) ? (
                                <>
                                  <button
                                    className="icon-button"
                                    aria-label={"拒绝" + r.title}
                                    onClick={() => {
                                      setReason("");
                                      setDisposition({
                                        record: r,
                                        action: "reject",
                                      });
                                    }}
                                  >
                                    <X size={15} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={"删除" + r.title}
                                    onClick={() => {
                                      setReason("");
                                      setDisposition({
                                        record: r,
                                        action: "delete",
                                      });
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void act(
                                        () =>
                                          post(
                                            "/api/v1/requirements/" +
                                              r.id +
                                              "/restore",
                                            { expectedVersion: r.version },
                                          ),
                                        "已恢复为待确认需求",
                                      )
                                    }
                                  >
                                    <Undo2 size={14} />
                                    恢复
                                  </button>
                                  {r.status === "rejected" && (
                                    <button
                                      className="icon-button"
                                      aria-label={"删除" + r.title}
                                      onClick={() =>
                                        setDisposition({
                                          record: r,
                                          action: "delete",
                                        })
                                      }
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </>
                              ))}
                          </>
                        }
                      >
                        <Markdown text={r.body || "暂无说明"} />
                        {!isCurrent(r) && (
                          <p className="disposition-note">
                            {labels[r.status]}原因：{r.data.disposition?.reason}{" "}
                            ·{" "}
                            {formatDate(r.data.disposition?.at ?? r.updatedAt)}
                          </p>
                        )}
                        <div className="criteria-list">
                          {criteria.length > 0 && (
                            <div className="criteria-heading">
                              <span>验收标准</span>
                              <span>{criteria.length} 条</span>
                            </div>
                          )}
                          {criteria.map((c) => {
                            const row = graph.rows.find(
                              (row) => row.criterion.id === c.id,
                            );
                            const linkedCases = graph.cases.filter((tc) =>
                              tc.links.some((l) => l.criterion.id === c.id),
                            );
                            return (
                              <CompactRow
                                key={c.id}
                                record={c}
                                className="criterion-detail"
                                meta={
                                  <>
                                    <Confirmed record={c} />
                                    <Badge
                                      value={row?.state ?? "out_of_scope"}
                                    />
                                    <span className="muted small-text">
                                      {linkedCases.length} 用例
                                    </span>
                                  </>
                                }
                                actions={
                                  <Actions
                                    record={c}
                                    readonly={readonly || !isCurrent(r)}
                                  />
                                }
                              >
                                {c.body && <Markdown text={c.body} />}
                                <div className="trace-links">
                                  {linkedCases.map((tc) => (
                                    <Link
                                      key={tc.testCase.id}
                                      to={entityPath(tc.testCase)}
                                    >
                                      {tc.testCase.key} · {tc.testCase.title}
                                      <Badge value={tc.state} />
                                    </Link>
                                  ))}
                                  {!readonly && isCurrent(r) && (
                                    <button
                                      className="text-button green-text"
                                      onClick={() =>
                                        edit({
                                          kind: "check",
                                          taskId: task.id,
                                          criterionIds: [c.id],
                                        })
                                      }
                                    >
                                      <Plus size={13} />
                                      关联新用例
                                    </button>
                                  )}
                                </div>
                              </CompactRow>
                            );
                          })}
                        </div>
                        {!readonly && isCurrent(r) && (
                          <button
                            className="text-button green-text"
                            onClick={() =>
                              edit({
                                kind: "criterion",
                                taskId: task.id,
                                requirementId: r.id,
                              })
                            }
                          >
                            <Plus size={14} />
                            添加验收标准
                          </button>
                        )}
                      </CompactRow>
                    );
                  })}
              </section>
            );
          })}
        {!list.items.length && (
          <Empty
            title={
              view === "rejected"
                ? "没有被拒绝的需求"
                : view === "deleted"
                  ? "回收站为空"
                  : "暂无匹配的需求"
            }
          />
        )}
      </div>
      {disposition && (
        <Modal
          title={disposition.action === "reject" ? "拒绝需求" : "删除需求"}
          onClose={() => setDisposition(undefined)}
        >
          <form className="editor" onSubmit={submit}>
            <strong>
              {disposition.record.key} · {disposition.record.title}
            </strong>
            <p className="muted">
              此需求将退出当前验收范围；验收标准、用例关联和执行记录保留，可随时恢复。恢复后需重新确认与验证。
            </p>
            <label>
              原因
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <footer>
              <Button
                variant="secondary"
                onClick={() => setDisposition(undefined)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy || !reason.trim()}>
                {disposition.action === "reject"
                  ? "移入拒绝列表"
                  : "移入回收站"}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

export function TestCasesPanel({ task }: { task: Entity }) {
  const { records, edit } = useHub(),
    [filter, setFilter] = useState("all");
  const graph = traceability(task, records),
    readonly = ["done", "cancelled"].includes(task.status);
  const cases = graph.cases.filter(
    (c) =>
      filter === "all" ||
      (filter === "gaps"
        ? [
            "unlinked",
            "stale",
            "missing",
            "failed",
            "blocked",
            "error",
          ].includes(c.state)
        : c.state === filter),
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>测试用例</h2>
          <p className="muted">
            需求 → 验收标准 → 用例 → 执行证据，双向追溯每一项结论。
          </p>
        </div>
        {!readonly && (
          <Button
            variant="small"
            onClick={() => edit({ kind: "check", taskId: task.id })}
          >
            <Plus size={15} />
            添加测试用例
          </Button>
        )}
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["gaps", "待处理"],
            ["passed", "已通过"],
            ["out_of_scope", "范围外"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={v === filter ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="muted small-text">
          未关联 {graph.gaps.unlinkedCases.length} · 待复验{" "}
          {graph.gaps.staleCases.length} · 未覆盖标准{" "}
          {graph.gaps.uncoveredCriteria.length}
        </span>
      </div>
      <RecordList records={cases.map((c) => c.testCase)} empty="还没有测试用例">
        {(c) => {
          const trace = graph.cases.find((t) => t.testCase.id === c.id)!;
          return (
            <CompactRow
              record={c}
              meta={
                <>
                  <Badge value={c.data.type} />
                  <Confirmed record={c} />
                  <span className="muted small-text">
                    {trace.links.length} 标准
                  </span>
                  <Badge value={trace.state} />
                </>
              }
              actions={
                <>
                  <Actions record={c} readonly={readonly} />
                  {!readonly && (
                    <button
                      className="text-button green-text"
                      onClick={() =>
                        edit({ kind: "result", taskId: task.id, checkId: c.id })
                      }
                    >
                      记录执行
                    </button>
                  )}
                </>
              }
            >
              <Markdown text={c.body} />
              <div className="case-spec">
                {[
                  ["前置条件", c.data.preconditions],
                  ["执行步骤", c.data.steps],
                  ["预期结果", c.data.expectedResult],
                  ["自动化定位", c.data.automationRef],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label}>
                      <h4>{label}</h4>
                      <Markdown text={value!} />
                    </div>
                  ))}
              </div>
              <h4>关联需求与验收标准</h4>
              <div className="trace-links">
                {trace.links.map((l) => (
                  <div key={l.criterion.id}>
                    {l.requirement && (
                      <Link to={entityPath(l.requirement)}>
                        {l.requirement.key} · {l.requirement.title}
                      </Link>
                    )}
                    <span> → </span>
                    <Link to={entityPath(l.criterion)}>
                      {l.criterion.key} · {l.criterion.title}
                    </Link>
                    <Badge value={l.active ? l.state : "out_of_scope"} />
                  </div>
                ))}
                {!trace.links.length && (
                  <p className="muted">
                    尚未关联验收标准。必需用例需关联标准后才能完成任务。
                  </p>
                )}
              </div>
              <h4>执行记录（{trace.runCount}）</h4>
              <div className="trace-links">
                {records
                  .filter((r) => r.kind === "result" && r.data.checkId === c.id)
                  .slice()
                  .reverse()
                  .map((r) => (
                    <Link key={r.id} to={entityPath(r)}>
                      {r.key} · {r.title}
                      <Badge value={r.data.outcome} />
                      <span className="muted">
                        {r.data.codeRef?.slice(0, 8)}
                      </span>
                    </Link>
                  ))}
              </div>
              {trace.issues.length > 0 && (
                <>
                  <h4>关联问题</h4>
                  <div className="trace-links">
                    {trace.issues.map((i) => (
                      <Link to={entityPath(i)} key={i.id}>
                        {i.key} · {i.title}
                        <Badge value={i.status} />
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </CompactRow>
          );
        }}
      </RecordList>
    </>
  );
}

export function TaskRecordsPanel({
  task,
  kind,
}: {
  task: Entity;
  kind: "design" | "work_item" | "issue" | "principle" | "result";
}) {
  const { records, edit, act } = useHub(),
    readonly = ["done", "cancelled"].includes(task.status);
  const local = records
    .filter(
      (r) =>
        r.taskId === task.id &&
        isCurrent(r) &&
        (r.kind === kind || (kind === "issue" && r.kind === "question")),
    )
    .sort((a, b) =>
      kind === "result" ? b.sequence - a.sequence : a.sequence - b.sequence,
    );
  const title = {
    design: "设计文档",
    work_item: "实施事项",
    issue: "问题与待决事项",
    principle: "基本原则",
    result: "执行记录",
  }[kind];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {kind === "principle" && (
            <p className="muted">
              原则归属当前任务，确认后在概览中更新采用的原则基线。
            </p>
          )}
        </div>
        {!readonly && (
          <div className="button-row">
            {kind === "issue" && (
              <Button
                variant="secondary small"
                onClick={() => edit({ kind: "question", taskId: task.id })}
              >
                提出疑问
              </Button>
            )}
            <Button
              variant="small"
              onClick={() => edit({ kind, taskId: task.id })}
            >
              <Plus size={15} />
              {
                {
                  design: "新建设计",
                  work_item: "添加实施事项",
                  issue: "记录问题",
                  principle: "新增原则",
                  result: "记录验证",
                }[kind]
              }
            </Button>
          </div>
        )}
      </div>
      <RecordList records={local}>
        {(r) => (
          <CompactRow
            record={r}
            meta={
              <>
                {["design", "principle"].includes(r.kind) ? (
                  <Confirmed record={r} />
                ) : (
                  <Badge
                    value={r.kind === "result" ? r.data.outcome : r.status}
                  />
                )}
                <span className="muted small-text">
                  {r.kind === "result"
                    ? r.data.codeRef?.slice(0, 8)
                    : (r.data.assignee ??
                      (r.data.category
                        ? (labels[r.data.category] ?? r.data.category)
                        : ""))}
                </span>
                {r.data.blocking && <Badge value="blocked">阻塞</Badge>}
                {r.kind === "principle" && <Badge value={r.data.strength} />}
              </>
            }
            actions={
              <>
                {r.kind === "result" ? (
                  <StarButton record={r} />
                ) : (
                  <Actions record={r} readonly={readonly} />
                )}{" "}
                {!readonly && availableTransitions(r).length > 0 && (
                  <select
                    className="status-select"
                    aria-label={"变更" + r.title + "状态"}
                    value=""
                    onChange={(e) =>
                      void act(
                        () =>
                          post("/api/v1/records/" + r.id + "/transitions", {
                            expectedVersion: r.version,
                            status: e.target.value,
                          }),
                        "状态已更新",
                      )
                    }
                  >
                    <option disabled value="">
                      变更状态
                    </option>
                    {availableTransitions(r).map((next) => (
                      <option key={next} value={next}>
                        {labels[next]}
                      </option>
                    ))}
                  </select>
                )}
              </>
            }
          >
            <Markdown text={r.body} />
            {r.kind === "principle" && (
              <p className="muted">{r.data.rationale}</p>
            )}
            {r.kind === "issue" && (
              <div className="trace-links">
                {records
                  .filter((c) => r.data.checkIds?.includes(c.id))
                  .map((c) => (
                    <Link key={c.id} to={entityPath(c)}>
                      {c.key} · {c.title}
                    </Link>
                  ))}
              </div>
            )}
            {r.kind === "result" && (
              <>
                <p className="muted">
                  {formatDate(r.createdAt)} · 环境：{r.data.environment} ·
                  commit {r.data.codeRef}
                </p>
                <Markdown text={r.data.evidence ?? ""} />
                <h4>本次执行绑定的版本</h4>
                <div className="trace-links">
                  {[
                    ...Object.entries(r.data.requirementVersions ?? {}),
                    ...Object.entries(r.data.criterionVersions ?? {}),
                    [r.data.checkId!, r.data.checkVersion!] as const,
                  ].map(([id, version]) => {
                    const e = records.find((e) => e.id === id);
                    return e ? (
                      <Link key={id} to={entityPath(e)}>
                        {e.key} · {e.title} · v{version}
                        {e.version !== version && <Badge value="stale" />}
                      </Link>
                    ) : null;
                  })}
                </div>
                {!r.data.requirementVersions && (
                  <p className="disposition-note">
                    历史证据未记录需求版本，需要重新验证。
                  </p>
                )}
              </>
            )}
          </CompactRow>
        )}
      </RecordList>
    </>
  );
}

export function TodosPanel({ task }: { task?: Entity }) {
  const { records, project, edit, act } = useHub(),
    [status, setStatus] = useState("inbox"),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [assign, setAssign] = useState<Entity>(),
    [target, setTarget] = useState("");
  const readonly = task && ["done", "cancelled"].includes(task.status);
  const todos = records.filter(
    (r) =>
      r.kind === "todo" &&
      isCurrent(r) &&
      (task
        ? r.taskId === task.id
        : project === "all" || r.projectId === project) &&
      (status === "all" || r.status === status),
  );
  async function quick(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const result = await act(
      () =>
        post("/api/v1/todos", {
          title: text.trim(),
          taskId: task?.id,
          projectId: task ? undefined : project === "all" ? null : project,
          data: { type: "idea" },
        }),
      "待办已保存",
    );
    if (result) setText("");
    setBusy(false);
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>{task ? "任务待办" : "待办事项"}</h2>
          <p className="muted">
            {task
              ? "围绕此任务记录想法和下一步，Agent 可同步读取。"
              : "随时捕捉想法，随后归入具体任务。这里汇总全局与任务待办。"}
          </p>
        </div>
        {!readonly && (
          <Button
            variant="small"
            onClick={() => edit({ kind: "todo", taskId: task?.id })}
          >
            <Plus size={15} />
            新建待办
          </Button>
        )}
      </div>
      {!readonly && (
        <form className="quick-capture compact-capture" onSubmit={quick}>
          <input
            aria-label="随手记下想法"
            placeholder="想到什么，先记下来…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
          />
          <Button variant="small" type="submit" disabled={busy || !text.trim()}>
            记下来
          </Button>
        </form>
      )}
      <div className="segmented">
        {[
          ["inbox", "待整理"],
          ["planned", "已计划"],
          ["done", "已完成"],
          ["converted", "已转任务"],
          ["all", "全部"],
        ].map(([v, l]) => (
          <button
            key={v}
            className={status === v ? "selected" : ""}
            onClick={() => setStatus(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <RecordList records={todos}>
        {(r) => {
          const parent = records.find((t) => t.id === r.taskId),
            locked =
              readonly ||
              (parent && ["done", "cancelled"].includes(parent.status));
          return (
            <CompactRow
              record={r}
              meta={
                <>
                  <Badge value={r.status} />
                  <Badge value={r.data.priority} />
                  {!task &&
                    (parent ? (
                      <Link className="parent-task" to={entityPath(parent)}>
                        {parent.title}
                      </Link>
                    ) : (
                      <span className="muted small-text">全局</span>
                    ))}
                </>
              }
              actions={
                <>
                  <Actions record={r} readonly={Boolean(locked)} />
                  {!locked && !r.data.targetTaskId && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setAssign(r);
                        setTarget(r.taskId ?? "");
                      }}
                    >
                      归属任务
                    </button>
                  )}
                  {!locked && availableTransitions(r).length > 0 && (
                    <select
                      className="status-select"
                      aria-label={"变更" + r.title + "状态"}
                      value=""
                      onChange={(e) =>
                        void act(
                          () =>
                            post("/api/v1/records/" + r.id + "/transitions", {
                              expectedVersion: r.version,
                              status: e.target.value,
                            }),
                          "状态已更新",
                        )
                      }
                    >
                      <option value="" disabled>
                        变更状态
                      </option>
                      {availableTransitions(r).map((v) => (
                        <option key={v} value={v}>
                          {labels[v]}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              }
            >
              <Markdown text={r.body || "暂无说明"} />
              {r.data.targetTaskId ? (
                <Link to={"/tasks/" + r.data.targetTaskId}>
                  打开已转化的任务
                </Link>
              ) : (
                !locked &&
                !r.taskId && (
                  <Button
                    variant="secondary small"
                    onClick={() => {
                      const projectId =
                        r.projectId ??
                        records.find((p) => p.kind === "project")?.id;
                      if (projectId)
                        void act(
                          () =>
                            post("/api/v1/todos/" + r.id + "/convert", {
                              expectedVersion: r.version,
                              projectId,
                            }),
                          "已转为新任务",
                        );
                    }}
                  >
                    转为新任务
                  </Button>
                )
              )}
            </CompactRow>
          );
        }}
      </RecordList>
      {assign && (
        <Modal title="归属任务" onClose={() => setAssign(undefined)}>
          <form
            className="editor"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const result = await act(
                () =>
                  post("/api/v1/todos/" + assign.id + "/assign", {
                    expectedVersion: assign.version,
                    taskId: target || null,
                  }),
                "待办归属已更新",
              );
              setBusy(false);
              if (result) setAssign(undefined);
            }}
          >
            <label>
              选择任务
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
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
            <footer>
              <Button type="submit" disabled={busy}>
                保存归属
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
