import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import type { Entity } from "../shared/domain";
import { Empty } from "./components";

export function useList<T>(
  items: T[],
  searchable: (item: T) => string,
  focusId?: string,
  id: (item: T) => string = () => "",
) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(25);
  const filtered = items.filter((item) =>
    searchable(item).toLowerCase().includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size)),
    current = Math.min(page, pages);
  useEffect(() => setPage(1), [search, size]);
  const focusIndex = items.findIndex((item) => id(item) === focusId);
  useEffect(() => {
    if (focusId) setSearch("");
  }, [focusId]);
  useEffect(() => {
    if (focusId && focusIndex >= 0) setPage(Math.floor(focusIndex / size) + 1);
  }, [focusId, focusIndex, size]);
  const controls = (
    <div className="list-controls">
      <label className="inline-search">
        <Search size={15} />
        <input
          aria-label="搜索列表"
          placeholder="搜索编号、标题或内容…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <span className="muted small-text">{filtered.length} 条</span>
      <div className="pagination">
        <select
          aria-label="每页条数"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / 页
            </option>
          ))}
        </select>
        <button
          aria-label="上一页"
          disabled={current === 1}
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
        <span>
          {current} / {pages}
        </span>
        <button
          aria-label="下一页"
          disabled={current === pages}
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
  return {
    items: filtered.slice((current - 1) * size, current * size),
    controls,
  };
}
export function RecordList({
  records,
  children,
  empty = "暂无条目",
}: {
  records: Entity[];
  children: (r: Entity) => ReactNode;
  empty?: string;
}) {
  const [params] = useSearchParams();
  const list = useList(
    records,
    (r) => `${r.key} ${r.title} ${r.body} ${JSON.stringify(r.data)}`,
    params.get("focus") ?? undefined,
    (r) => r.id,
  );
  return (
    <>
      {list.controls}
      <div className="compact-list">
        {list.items.map((r) => (
          <div key={r.id}>{children(r)}</div>
        ))}
        {!list.items.length && <Empty title={empty} />}
      </div>
    </>
  );
}
export function CompactRow({
  record,
  meta,
  actions,
  children,
  forceOpen,
  focused = false,
  className = "",
}: {
  record: Entity;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  forceOpen?: boolean;
  focused?: boolean;
  className?: string;
}) {
  const [params] = useSearchParams();
  const focus = focused || params.get("focus") === record.id;
  const [open, setOpen] = useState(focus);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);
  useEffect(() => {
    if (focus) {
      setOpen(true);
      requestAnimationFrame(() =>
        document
          .getElementById("record-" + record.id)
          ?.scrollIntoView?.({ block: "nearest" }),
      );
    }
  }, [focus, record.id]);
  return (
    <article
      id={"record-" + record.id}
      className={["compact-record", className, focus ? "focused" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="compact-row">
        <button
          className="row-toggle"
          aria-label={(open ? "收起" : "展开") + record.title}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={15} className={open ? "rotated" : ""} />
          <span className="mono">{record.key}</span>
          <strong title={record.title}>{record.title}</strong>
        </button>
        <div className="row-meta">{meta}</div>
        <div className="row-actions">{actions}</div>
      </div>
      {open && <div className="compact-detail">{children}</div>}
    </article>
  );
}
