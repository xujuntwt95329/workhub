import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, LoaderCircle } from "lucide-react";
import { Badge, Markdown } from "./components";
import { api, post, formatDate } from "./lib/api";

type SummaryState = {
  configured: boolean;
  data: {
    answer: string;
    stale: boolean;
    finished_at: string;
    created_at: string;
  } | null;
  latestRun: { id: string; status: string; error?: string } | null;
};
export function AssistantSummary({ taskId }: { taskId: string }) {
  const [state, setState] = useState<SummaryState>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestVersion = useRef(0);
  async function load() {
    const version = ++requestVersion.current;
    try {
      const next = await api<SummaryState>("/api/tasks/" + taskId + "/summary");
      if (version !== requestVersion.current) return;
      setState(next);
      setError("");
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    setState(undefined);
    setError("");
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      clearInterval(timer);
      requestVersion.current++;
    };
  }, [taskId]);
  const pending =
    submitting ||
    ["queued", "running"].includes(state?.latestRun?.status ?? "");
  async function generate() {
    setSubmitting(true);
    requestVersion.current++;
    try {
      const run = await post("/api/assistant/runs", {
        question: "总结此任务",
        taskId,
        summary: true,
      });
      setState((prev) => ({
        configured: true,
        data: prev?.data ?? null,
        latestRun: run,
      }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="panel detail-panel" aria-label="任务智能概览">
      <div className="panel-heading">
        <h2>
          <Sparkles size={18} />
          智能概览
        </h2>
        {state?.configured && (
          <button
            className="text-button"
            disabled={pending}
            onClick={() => void generate()}
          >
            {pending ? "生成中…" : state.data ? "重新生成" : "生成概览"}
          </button>
        )}
      </div>
      {error && (
        <p className="error-text" role="alert">
          概览暂时不可用：{error}{" "}
          <button className="text-button" onClick={() => void load()}>
            重试读取
          </button>
        </p>
      )}
      {pending && (
        <p className="muted" role="status">
          <LoaderCircle size={14} className="spin" />{" "}
          {state?.latestRun?.status === "running"
            ? "正在生成概览…"
            : "概览已排队，等待生成…"}
        </p>
      )}
      {state?.latestRun?.status === "failed" && (
        <p className="error-text" role="alert">
          最近一次生成失败：{state.latestRun.error || "请重试"}
          {state.data ? "。下方保留上次成功的概览。" : ""}
        </p>
      )}
      {state?.latestRun?.status === "cancelled" && (
        <p className="muted">最近一次生成已取消，可以重新生成。</p>
      )}
      {state?.data ? (
        <>
          <div className="badge-row">
            <Badge value={state.data.stale ? "stale" : "passed"}>
              {state.data.stale ? "内容变化，待更新" : "与当前数据一致"}
            </Badge>
            <small className="muted">
              {formatDate(state.data.finished_at ?? state.data.created_at)}
            </small>
          </div>
          <Markdown
            text={state.data.answer.replace(/\]\(workhub:[^)]+\)/g, "]")}
          />
        </>
      ) : (
        !pending && (
          <div className="summary-placeholder">
            <Sparkles size={24} />
            <p>
              {!state
                ? "正在读取概览…"
                : state.configured
                  ? "尚未生成概览，点击“生成概览”整理进展、阻塞和下一步。"
                  : "配置模型后，可生成任务概览。"}
            </p>
            {state?.configured === false && (
              <Link to="/settings" className="text-link">
                配置模型
              </Link>
            )}
          </div>
        )
      )}
    </div>
  );
}
