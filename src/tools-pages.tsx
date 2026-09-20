import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Sparkles,
  ArrowUp,
  ArrowUpRight,
  Settings,
  KeyRound,
  ShieldCheck,
  Plus,
  Copy,
  Trash2,
  Check,
  Download,
  LoaderCircle,
  Square,
  MessageCircle,
  FileText,
  ExternalLink,
  PlugZap,
  Database,
  Code2,
  Package,
} from "lucide-react";
import { useHub } from "./state";
import { api, post, formatDate } from "./lib/api";
import { PageHeading } from "./pages";
import { Button, Markdown, Modal, Badge } from "./components";
import { PluginSettings } from "./plugin-settings";
type Answer = {
  id: string;
  question: string;
  answer?: string;
  status: string;
  error?: string;
  sources?: { id: string; title: string; taskId?: string }[];
};
export function AssistantPage() {
  const { records, notify } = useHub();
  const [params] = useSearchParams(),
    [scope, setScope] = useState(params.get("task") ?? ""),
    [question, setQuestion] = useState(""),
    [answers, setAnswers] = useState<Answer[]>([]),
    [busy, setBusy] = useState(false),
    [activeId, setActiveId] = useState(""),
    [configured, setConfigured] = useState<boolean | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api("/api/settings/llm")
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [answers]);
  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(async () => {
      try {
        const run = await api<Answer>("/api/assistant/runs/" + activeId);
        setAnswers((prev) =>
          prev.map((a) => (a.id === run.id ? { ...a, ...run } : a)),
        );
        if (!["queued", "running"].includes(run.status)) {
          setActiveId("");
          setBusy(false);
        }
      } catch (e) {
        notify((e as Error).message, true);
        setActiveId("");
        setBusy(false);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [activeId]);
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const run = await post("/api/assistant/runs", {
        question: text,
        taskId: scope || undefined,
      });
      setAnswers((prev) => [...prev, { ...run, question: text }]);
      setQuestion("");
      setActiveId(run.id);
    } catch (e) {
      notify((e as Error).message, true);
      setBusy(false);
    }
  }
  const suggestions = [
    ["进展与阻塞", "目前有哪些工作被阻塞？建议先处理什么？"],
    ["质量与证据", "哪些验收标准还缺少当前有效的验证证据？"],
    ["设计与取舍", "总结当前任务的设计方案、重要取舍和待决问题。"],
    ["灵感与下一步", "待办中有哪些值得进一步整理成任务的想法？"],
  ];
  return (
    <div className="assistant-page">
      <div className="assistant-header">
        <div>
          <span className="eyebrow">YOUR THINKING PARTNER</span>
          <h1>
            <Sparkles size={25} />
            智能助手
          </h1>
        </div>
        <div className="scope-selector">
          <span>对话范围</span>
          <select
            aria-label="助手范围"
            value={scope}
            disabled={busy}
            onChange={(e) => {
              setScope(e.target.value);
              setAnswers([]);
            }}
          >
            <option value="">整个工作空间</option>
            {records
              .filter((r) => r.kind === "task")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="conversation">
        {!answers.length && (
          <div className="assistant-welcome">
            <div className="assistant-orb">
              <Sparkles size={32} />
            </div>
            <h2>一起把复杂的事，聊清楚。</h2>
            <p>
              我会阅读工作空间里的工程记录，
              <br />
              帮你整理思路，并把依据一起带回来。
            </p>
            <div className="prompt-grid">
              {suggestions.map(([title, text]) => (
                <button
                  key={title}
                  disabled={busy}
                  onClick={() => void ask(text)}
                >
                  <span>
                    {title}
                    <ArrowUpRight size={15} />
                  </span>
                  <p>{text}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {answers.map((a) => (
          <div className="conversation-turn" key={a.id}>
            <div className="user-message">{a.question}</div>
            <div className="assistant-message">
              <span className="assistant-small-icon">
                <Sparkles size={18} />
              </span>
              <div className="grow">
                {["queued", "running"].includes(a.status) ? (
                  <div className="thinking">
                    <span />
                    <span />
                    <span />
                    <small>
                      {a.status === "queued"
                        ? "正在准备上下文…"
                        : "正在整理工程记录…"}
                    </small>
                  </div>
                ) : a.status === "succeeded" ? (
                  <>
                    <Markdown
                      text={(a.answer ?? "").replace(
                        /\]\(workhub:[^)]+\)/g,
                        "]",
                      )}
                    />
                    {!!a.sources?.length && (
                      <div className="source-links">
                        <small>参考来源</small>
                        {a.sources.map((s, i) => (
                          <Link
                            key={s.id + i}
                            to={
                              s.taskId
                                ? "/tasks/" + s.taskId
                                : s.id &&
                                    records.find((r) => r.id === s.id)?.kind ===
                                      "task"
                                  ? "/tasks/" + s.id
                                  : "/principles"
                            }
                          >
                            <FileText size={13} />
                            {s.title}
                            <ArrowUpRight size={12} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className={a.status === "failed" ? "error-text" : "muted"}>
                    {a.error ?? "本次生成已取消"}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="composer-wrap">
        {configured === false && (
          <div className="configuration-notice">
            <KeyRound size={16} />
            <span>配置 LLM API Key 后，即可启用智能问答。</span>
            <Link to="/settings">
              前往设置 <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            rows={2}
            placeholder="问问进展、设计、质量，或者下一步…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void ask(question);
              }
            }}
            maxLength={4000}
            aria-label="向助手提问"
          />
          <div>
            <span>
              <ShieldCheck size={13} />
              依据工程记录回答 · {scope ? "当前任务" : "全局范围"}
            </span>
            {busy ? (
              <button
                type="button"
                className="send-button"
                aria-label="停止生成"
                onClick={() =>
                  void post("/api/assistant/runs/" + activeId + "/cancel", {})
                }
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!question.trim() || configured === false}
                aria-label="发送问题"
              >
                <ArrowUp size={19} />
              </button>
            )}
          </div>
        </form>
        <p className="composer-footnote">
          回答可能存在疏漏，重要结论请核对引用。Ctrl / ⌘ + Enter 发送。
        </p>
      </div>
    </div>
  );
}
export function SettingsPage() {
  const { records, notify } = useHub();
  const [search, setSearch] = useSearchParams();
  const requestedTab = search.get("tab");
  const tab = ["model", "agents", "plugins", "data"].includes(
    requestedTab ?? "",
  )
    ? requestedTab
    : "model";
  const setTab = (value: string) => setSearch({ tab: value });
  const [config, setConfig] = useState<any>({
      baseUrl: "",
      model: "",
      autoSummary: false,
      maxOutputTokens: 1500,
      dailyLimit: 50,
    }),
    [key, setKey] = useState(""),
    [saving, setSaving] = useState(false),
    [tokens, setTokens] = useState<any[]>([]),
    [newToken, setNewToken] = useState(false),
    [revealed, setRevealed] = useState("");
  const loadTokens = () => api("/api/tokens").then((r) => setTokens(r.data));
  useEffect(() => {
    api("/api/settings/llm")
      .then((c) => setConfig((prev: any) => ({ ...prev, ...c })))
      .catch((e) => notify(e.message, true));
    void loadTokens();
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: key || undefined,
          autoSummary: config.autoSummary,
          maxOutputTokens: Number(config.maxOutputTokens),
          dailyLimit: Number(config.dailyLimit),
        }),
      });
      setConfig((c: any) => ({ ...c, ...r }));
      setKey("");
      notify("模型配置已保存");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="让工作空间，适合你的方式。"
        description="连接模型与 Agent，把工程资料掌握在自己手中。"
      />
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            ["model", "模型与智能助手", Sparkles],
            ["agents", "Agent 接入", PlugZap],
            ["plugins", "Claude 插件", Package],
            ["data", "数据与接口", Database],
          ].map(([value, label, Icon]) => {
            const I = Icon as typeof Sparkles;
            return (
              <button
                key={String(value)}
                className={tab === value ? "selected" : ""}
                onClick={() => setTab(String(value))}
              >
                <I size={18} />
                {String(label)}
              </button>
            );
          })}
        </nav>
        <div>
          {tab === "plugins" && <PluginSettings notify={notify} />}
          {tab === "model" && (
            <form className="panel settings-panel" onSubmit={save}>
              <div className="panel-heading">
                <h2>
                  <Sparkles size={19} />
                  LLM 连接
                </h2>
                <Badge value={config.configured ? "passed" : "draft"}>
                  {config.configured ? "已配置" : "尚未配置"}
                </Badge>
              </div>
              <p className="muted">
                支持 Chat Completions
                兼容协议。启用后，选定范围的工程上下文会发送到你配置的模型服务。
              </p>
              <div className="form-grid">
                <label className="full">
                  API 服务地址
                  <input
                    type="url"
                    required
                    value={config.baseUrl}
                    onChange={(e) =>
                      setConfig({ ...config, baseUrl: e.target.value })
                    }
                    placeholder="https://your-provider.example/v1"
                  />
                </label>
                <label>
                  模型名称
                  <input
                    required
                    value={config.model}
                    onChange={(e) =>
                      setConfig({ ...config, model: e.target.value })
                    }
                    placeholder="填写提供方的模型 ID"
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    required={!config.configured}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      config.configured
                        ? "已加密保存，留空保留原 Key"
                        : "输入模型服务 API Key"
                    }
                  />
                </label>
                <label>
                  单次输出 token 上限
                  <input
                    type="number"
                    min={100}
                    max={8000}
                    value={config.maxOutputTokens}
                    onChange={(e) =>
                      setConfig({ ...config, maxOutputTokens: e.target.value })
                    }
                  />
                </label>
                <label>
                  每日调用次数上限
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={config.dailyLimit}
                    onChange={(e) =>
                      setConfig({ ...config, dailyLimit: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="toggle-setting">
                <div>
                  <strong>自动更新任务概览</strong>
                  <small>工程内容变更后合并生成，保留旧摘要与来源版本。</small>
                </div>
                <input
                  type="checkbox"
                  checked={config.autoSummary}
                  onChange={(e) =>
                    setConfig({ ...config, autoSummary: e.target.checked })
                  }
                />
              </label>
              <div className="security-note">
                <ShieldCheck size={17} />
                <span>
                  Key 仅在服务器加密保存，不进入聊天、报告或普通导出。
                </span>
              </div>
              <div className="settings-footer">
                <span className="muted">今日已调用 {config.calls ?? 0} 次</span>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  保存配置
                </Button>
              </div>
            </form>
          )}
          {tab === "agents" && (
            <div className="panel settings-panel">
              <div className="panel-heading">
                <h2>
                  <PlugZap size={19} />
                  Agent 凭证
                </h2>
                <Button
                  onClick={() => {
                    setNewToken(true);
                    setRevealed("");
                  }}
                >
                  <Plus size={16} />
                  创建凭证
                </Button>
              </div>
              <p className="muted">
                为每个 Agent 分配独立凭证，可限定到具体任务，随时撤销。
              </p>
              <div className="connection-address">
                <span>HTTP API</span>
                <code>{window.location.origin}/api/v1</code>
              </div>
              <div className="connection-address">
                <span>MCP</span>
                <code>{window.location.origin}/mcp</code>
              </div>
              <p className="form-hint">
                支持远程 MCP OAuth 登录授权，也可在支持 Bearer Token
                的客户端配置独立凭证。
                <Link to="/settings?tab=plugins" className="green">
                  {" "}
                  使用 Claude？下载配好 Skills 的插件 →
                </Link>
              </p>
              {tokens.map((t) => (
                <div className="token-row" key={t.id}>
                  <KeyRound size={17} />
                  <div className="grow">
                    <strong>{t.name}</strong>
                    <small>
                      {t.task_ids.includes("*")
                        ? "整个工作空间"
                        : t.task_ids.length + " 个任务"}{" "}
                      · {t.permissions.join(" / ")}
                    </small>
                  </div>
                  <Badge value={t.revoked ? "cancelled" : "passed"}>
                    {t.revoked ? "已撤销" : "有效"}
                  </Badge>
                  {!t.revoked && (
                    <button
                      className="icon-button"
                      aria-label={"撤销" + t.name}
                      onClick={async () => {
                        await api("/api/tokens/" + t.id, { method: "DELETE" });
                        await loadTokens();
                        notify("凭证已撤销");
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              {!tokens.length && (
                <p className="muted top-space">还没有创建 Agent 凭证。</p>
              )}
            </div>
          )}
          {tab === "data" && (
            <div className="panel settings-panel">
              <h2>
                <Database size={19} />
                你的数据，始终属于你
              </h2>
              <p className="muted">
                导出包含工程记录、版本、评审与报告，不包含密码、API Key
                和会话凭证。
              </p>
              <a
                className="button secondary"
                href="/api/v1/workspace/export"
                download="workhub-workspace.json"
              >
                <Download size={16} />
                导出工作空间 JSON
              </a>
              <div className="settings-divider" />
              <h3>API 契约</h3>
              <p className="muted">
                接口提供版本检查和幂等支持，Agent 与界面共享同一套业务规则。
              </p>
              <a
                className="text-link"
                href="/api/openapi.json"
                target="_blank"
                rel="noreferrer"
              >
                查看 OpenAPI 文档 <ExternalLink size={15} />
              </a>
              <div className="settings-divider" />
              <h3>备份与恢复</h3>
              <p className="muted">
                服务器部署使用
                PostgreSQL。项目提供数据库备份、恢复命令及部署说明；业务导出适合归档与检索，完整灾难恢复请使用数据库备份。
              </p>
            </div>
          )}
        </div>
      </div>
      {newToken && (
        <TokenModal
          records={records}
          revealed={revealed}
          onToken={(t) => {
            setRevealed(t);
            void loadTokens();
          }}
          onClose={() => {
            setNewToken(false);
            setRevealed("");
          }}
        />
      )}
    </>
  );
}
function TokenModal({
  records,
  revealed,
  onToken,
  onClose,
}: {
  records: ReturnType<typeof useHub>["records"];
  revealed: string;
  onToken: (s: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(""),
    [scope, setScope] = useState("*"),
    [write, setWrite] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="创建 Agent 凭证" onClose={onClose}>
      <div className="modal-content">
        {revealed ? (
          <>
            <div className="success-box">
              凭证已创建，仅在此显示一次，请妥善保存。
            </div>
            <code className="token-secret">{revealed}</code>
            <Button
              onClick={() => void navigator.clipboard.writeText(revealed)}
            >
              <Copy size={15} />
              复制凭证
            </Button>
          </>
        ) : (
          <form
            className="editor"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await post("/api/tokens", {
                  name,
                  taskIds: [scope],
                  permissions: write ? ["read", "write"] : ["read"],
                  days: 30,
                });
                onToken(r.token);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Agent 名称
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：质量 Agent"
              />
            </label>
            <label>
              授权范围
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="*">整个工作空间</option>
                {records
                  .filter((r) => r.kind === "task")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={write}
                onChange={(e) => setWrite(e.target.checked)}
              />
              允许创建和修改内容（不含批准、豁免或验收）
            </label>
            <p className="muted">凭证有效期 30 天，可随时撤销。</p>
            {error && <div className="error-box">{error}</div>}
            <Button type="submit">
              <KeyRound size={16} />
              创建凭证
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
