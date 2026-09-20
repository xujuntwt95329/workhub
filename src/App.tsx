import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Link, Route, Routes, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Layers,
  Lightbulb,
  Compass,
  Sparkles,
  ChartNoAxesCombined,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  Bell,
  LogOut,
  Check,
  Menu,
  LoaderCircle,
  X,
  ShieldCheck,
} from "lucide-react";
import {
  currentWorkspaceRecords,
  type Actor,
  type Entity,
} from "../shared/domain";
import { api, post, initials } from "./lib/api";
import { Button, Editor, type EditorSpec } from "./components";
import { HubContext, entityPath, type Hub } from "./state";
import { Dashboard, Tasks, Todos, Reviews } from "./pages";
import { TaskPage, ReportsPage } from "./task-page";
import { AssistantPage, SettingsPage } from "./tools-pages";
export function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        workhub<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function App() {
  const [status, setStatus] = useState<{
      initialized: boolean;
      actor?: Actor;
    } | null>(null),
    [records, setRecords] = useState<Entity[]>([]),
    [sample, setSample] = useState(false),
    [project, setProject] = useState("all"),
    [editor, setEditor] = useState<EditorSpec>(),
    [toast, setToast] = useState<{ message: string; error: boolean }>(),
    [startupError, setStartupError] = useState("");
  const refresh = useCallback(async () => {
    const b = await api<{ records: Entity[]; sample: boolean; actor: Actor }>(
      "/api/bootstrap",
    );
    setRecords(b.records);
    setSample(b.sample);
  }, []);
  const authenticate = useCallback(async () => {
    try {
      const s = await api("/api/auth/status");
      setStatus(s);
      if (s.actor) await refresh();
    } catch (e) {
      setStartupError(e instanceof Error ? e.message : "无法连接服务");
    }
  }, [refresh]);
  useEffect(() => {
    void authenticate();
  }, [authenticate]);
  useEffect(() => {
    if (!status?.actor) return;
    const i = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(i);
  }, [status?.actor, refresh]);
  useEffect(() => {
    if (!toast) return;
    const i = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(i);
  }, [toast]);
  const notify = (message: string, error = false) =>
    setToast({ message, error });
  async function act<T>(fn: () => Promise<T>, message = "已保存") {
    try {
      const result = await fn();
      await refresh();
      notify(message);
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败", true);
      return undefined;
    }
  }
  if (startupError)
    return (
      <div className="boot">
        <Logo />
        <p role="alert">{startupError}</p>
        <Button
          onClick={() => {
            setStartupError("");
            void authenticate();
          }}
        >
          重新连接
        </Button>
      </div>
    );
  if (!status)
    return (
      <div className="boot">
        <Logo />
        <LoaderCircle className="spin" />
        <p>正在打开你的工作空间…</p>
      </div>
    );
  if (!status.actor)
    return <Auth initialized={status.initialized} onReady={authenticate} />;
  const hub: Hub = {
    records,
    actor: status.actor,
    project,
    setProject,
    refresh,
    edit: setEditor,
    notify,
    act,
    sample,
  };
  return (
    <HubContext.Provider value={hub}>
      <Shell
        actor={status.actor}
        records={records}
        sample={sample}
        project={project}
        setProject={setProject}
        edit={setEditor}
        onLogout={async () => {
          await post("/api/auth/logout", {});
          setStatus({ ...status, actor: undefined });
          setRecords([]);
        }}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/authorize" element={<Consent />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Shell>
      {editor && (
        <Editor
          spec={editor}
          records={records}
          onClose={() => setEditor(undefined)}
          onSaved={refresh}
        />
      )}{" "}
      {toast && (
        <div
          className={"toast " + (toast.error ? "toast-error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button aria-label="关闭提示" onClick={() => setToast(undefined)}>
            <X size={16} />
          </button>
        </div>
      )}
    </HubContext.Provider>
  );
}
function Shell({
  actor,
  records,
  sample,
  project,
  setProject,
  edit,
  onLogout,
  children,
}: {
  actor: Actor;
  records: Entity[];
  sample: boolean;
  project: string;
  setProject: (v: string) => void;
  edit: (s: EditorSpec) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [mobile, setMobile] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    location = useLocation();
  const nav = [
    ["/", "工作台", LayoutDashboard],
    ["/tasks", "工程任务", Layers],
    ["/todos", "待办事项", Lightbulb],
    ["/assistant", "智能助手", Sparkles],
    ["/reports", "报告与矩阵", ChartNoAxesCombined],
  ] as const;
  const title =
    nav.find(([path]) =>
      path === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(path),
    )?.[1] ?? (location.pathname === "/reviews" ? "待我处理" : "工作空间设置");
  const pending = currentWorkspaceRecords(records).filter(
    (r) =>
      ["requirement", "design", "check", "principle"].includes(r.kind) &&
      !["archived", "deleted", "rejected"].includes(r.status) &&
      r.approvedVersion !== r.version,
  ).length;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setSearch("");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    setMobile(false);
    setSearch("");
  }, [location]);
  const results = search.trim()
    ? records
        .filter(
          (r) =>
            r.status !== "archived" &&
            (r.title + " " + r.key + " " + r.body)
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .slice(0, 7)
    : [];
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <Link to="/" className="logo-link">
          <Logo />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-icon">W</span>
          <div>
            <strong>个人工作空间</strong>
            <span>Make room for good work</span>
          </div>
          <span className="online-dot" />
        </div>
        <p className="nav-label">工作空间</p>
        <nav>
          {nav.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === "/todos" && (
                <span className="nav-count">
                  {
                    records.filter(
                      (r) => r.kind === "todo" && r.status === "inbox",
                    ).length
                  }
                </span>
              )}
              {path === "/assistant" && <span className="ai-tag">AI</span>}
            </NavLink>
          ))}
        </nav>
        <div className="project-filter">
          <p className="nav-label">项目视角</p>
          <select
            aria-label="切换项目"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="all">全部项目</option>
            {records
              .filter((r) => r.kind === "project")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </select>
          <button
            className="text-button"
            onClick={() => edit({ kind: "project" })}
          >
            <Plus size={14} />
            添加项目
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span>一点清晰，一点进展。</span>
            <small>Build something that matters.</small>
            <span className="note-spark">✦</span>
          </div>
          <NavLink to="/settings" className="nav-item">
            <Settings size={18} />
            <span>设置与接入</span>
          </NavLink>
          <div className="profile">
            <span className="avatar">{initials(actor.name)}</span>
            <div>
              <strong>{actor.name}</strong>
              <small>个人开发者</small>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={onLogout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="打开导航"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            <span>工作空间</span>
            <span className="slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务、想法、文档…"
                aria-label="全局搜索"
              />
              <kbd>⌘ K</kbd>
              {search && (
                <div className="search-results">
                  {results.length ? (
                    results.map((r) => (
                      <Link to={entityPath(r)} key={r.id}>
                        <span className="mono">{r.key}</span>
                        <span>{r.title}</span>
                        <ArrowUpRight size={14} />
                      </Link>
                    ))
                  ) : (
                    <p>没有找到相关内容</p>
                  )}
                </div>
              )}
            </div>
            <Link
              to="/reviews"
              className="icon-button notification"
              aria-label={`待处理 ${pending} 项`}
            >
              <Bell size={18} />
              {pending > 0 && <i />}
            </Link>
            <span className="avatar small">{initials(actor.name)}</span>
          </div>
        </header>
        {sample && (
          <div className="sample-banner">
            示例空间 <span>· 当前工程内容为可编辑的演示数据</span>
          </div>
        )}
        <main className="page-content">{children}</main>
        <footer className="page-footer">
          <span>WORKHUB</span>
          <span>
            A little clarity. A little progress.{" "}
            <span className="footer-dot">✦</span> Happy work.
          </span>
        </footer>
      </div>
    </div>
  );
}
function Auth({
  initialized,
  onReady,
}: {
  initialized: boolean;
  onReady: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [sample, setSample] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(
        "/api/auth/" + (initialized ? "login" : "setup"),
        initialized
          ? { name, password }
          : { name, password, setupToken: token, sample },
      );
      await onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow">YOUR PERSONAL ENGINEERING SPACE</span>
          <h1>
            好想法，
            <br />
            值得被好好实现<span>。</span>
          </h1>
          <p>
            把需求、设计和验证放在一起。
            <br />
            留出更多时间，专注于创造。
          </p>
          <div className="auth-cards">
            <span>
              <Check size={18} /> 思路清晰
            </span>
            <span>
              <Layers size={18} /> 进展可见
            </span>
            <span>
              <Sparkles size={18} /> 与 AI 协作
            </span>
          </div>
        </div>
        <small>WorkHub · Happy work, thoughtfully.</small>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">
            {initialized ? "WELCOME BACK" : "LET’S GET STARTED"}
          </span>
          <h2>{initialized ? "欢迎回到你的工作空间" : "创建你的工作空间"}</h2>
          <p className="muted">
            {initialized
              ? "接着上次的进展，继续做有意思的事。"
              : "只属于你和你的 Agent，简单、清晰、有条理。"}
          </p>
          <label>
            你的名字
            <input
              required
              autoComplete="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="怎么称呼你？"
            />
          </label>
          <label>
            密码
            <input
              required
              type="password"
              autoComplete={initialized ? "current-password" : "new-password"}
              minLength={initialized ? 1 : 10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={initialized ? "输入密码" : "至少 10 个字符"}
            />
          </label>
          {!initialized && (
            <>
              <label>
                部署初始化密钥
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  placeholder="本地开发可留空，服务器部署需填写"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sample}
                  onChange={(e) => setSample(e.target.checked)}
                />
                加入可编辑的示例项目，快速熟悉工作流
              </label>
            </>
          )}
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowUpRight size={17} />
            )}{" "}
            {initialized ? "进入工作空间" : "创建并开始"}
          </Button>
          <p className="auth-footnote">
            <ShieldCheck size={14} /> 数据保存在你自己的服务器
          </p>
        </form>
      </div>
    </div>
  );
}
function Consent() {
  const [request, setRequest] = useState<{
      name: string;
      scope: string;
      redirectUri: string;
    }>(),
    [error, setError] = useState("");
  const query = useLocation().search;
  useEffect(() => {
    api("/api/oauth/request" + query)
      .then(setRequest)
      .catch((e) => setError(e.message));
  }, [query]);
  return (
    <div className="consent panel">
      <Compass size={30} />
      <h1>连接 MCP 客户端</h1>
      {error ? (
        <div className="error-box">{error}</div>
      ) : (
        <>
          <p>
            <strong>{request?.name}</strong> 希望访问你的 WorkHub。
          </p>
          <p>{request?.scope}</p>
          <small className="muted">回调地址：{request?.redirectUri}</small>
          <div className="button-row">
            <Link className="button secondary" to="/">
              取消
            </Link>
            <Button
              onClick={async () => {
                try {
                  const r = await post(
                    "/api/oauth/authorize",
                    Object.fromEntries(new URLSearchParams(query)),
                  );
                  window.location.assign(r.redirect);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              允许连接
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
