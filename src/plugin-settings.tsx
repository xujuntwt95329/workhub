import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Package,
  Download,
  Copy,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Monitor,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "./components";
import { api } from "./lib/api";
import { fetchPlugin, savePlugin } from "./lib/plugin-download";
import {
  pluginDownloadSchema,
  codeInstallCommands,
  tokenPowerShell,
  tokenBash,
  type PluginMetadata,
  type PluginDownloadInput,
} from "../shared/claude-plugin";
import {
  codexPluginDownloadSchema,
  codexInstallCommands,
  codexTokenBash,
  codexTokenPowerShell,
} from "../shared/codex-plugin";
import "./plugin-settings.css";

export function PluginSettings({
  notify,
}: {
  notify: (message: string, error?: boolean) => void;
}) {
  const [metadata, setMetadata] = useState<PluginMetadata>();
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<PluginDownloadInput["target"]>("code");
  const [authentication, setAuthentication] =
    useState<PluginDownloadInput["authentication"]>("oauth");
  const [baseUrl, setBaseUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [shell, setShell] = useState<"powershell" | "bash">("powershell");
  const isCodex = target === "codex";
  const client = isCodex ? "codex" : "claude";
  const installCommands = isCodex ? codexInstallCommands : codeInstallCommands;
  const tokenCommand = isCodex
    ? shell === "powershell"
      ? codexTokenPowerShell
      : codexTokenBash
    : shell === "powershell"
      ? tokenPowerShell
      : tokenBash;
  useEffect(() => {
    let active = true;
    setLoadError("");
    setMetadata(undefined);
    api<PluginMetadata>("/api/plugins/" + client)
      .then((value) => {
        if (active) {
          setMetadata(value);
          setBaseUrl((previous) => previous || value.publicUrl);
        }
      })
      .catch((error) => {
        if (active) setLoadError(error.message);
      });
    return () => {
      active = false;
    };
  }, [attempt, client]);
  const parsed = (
    isCodex ? codexPluginDownloadSchema : pluginDownloadSchema
  ).safeParse({
    target,
    authentication,
    baseUrl,
  });
  async function download() {
    if (!parsed.success || downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await fetchPlugin(parsed.data);
      savePlugin(blob, filename);
      notify("插件已生成，请按下方说明安装");
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setDownloading(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("安装命令已复制");
    } catch {
      notify("无法访问剪贴板，请手动选择并复制命令", true);
    }
  }
  if (loadError)
    return (
      <div className="panel settings-panel">
        <p role="alert">{loadError}</p>
        <Button onClick={() => setAttempt(attempt + 1)}>
          重新加载插件信息
        </Button>
      </div>
    );
  if (!metadata)
    return (
      <div className="panel settings-panel" role="status">
        正在读取插件信息…
      </div>
    );

  return (
    <div className={`plugin-settings${isCodex ? " codex-plugin" : ""}`}>
      <section className="panel plugin-hero">
        <div className="plugin-mark">
          <Package size={26} />
        </div>
        <div className="grow">
          <div className="plugin-kicker">
            WORKHUB × {isCodex ? "CODEX" : "CLAUDE"}{" "}
            <span>v{metadata.version}</span>
          </div>
          <h2>让 Agent 跟上你的工作方式。</h2>
          <p>
            把上下文、协作规则和工程工具，一起带进{" "}
            {isCodex ? "Codex" : "Claude"}。
          </p>
        </div>
        <span className="plugin-count">
          {metadata.skills.length} Skills · MCP
        </span>
      </section>

      <div className="plugin-grid">
        <section className="panel plugin-config">
          <h3>下载你的插件</h3>
          <p className="muted">选择使用方式，生成对应的安装包。</p>
          <div className="plugin-target" role="group" aria-label="Agent 客户端">
            <button
              type="button"
              aria-pressed={target === "code"}
              disabled={downloading}
              onClick={() => setTarget("code")}
            >
              <Terminal size={18} />
              <span>
                Claude Code<small>终端 / IDE</small>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={target === "desktop"}
              disabled={downloading}
              onClick={() => {
                setTarget("desktop");
                setAuthentication("oauth");
              }}
            >
              <Monitor size={18} />
              <span>
                Claude 桌面端<small>Chat / Cowork</small>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={isCodex}
              disabled={downloading}
              onClick={() => setTarget("codex")}
            >
              <Terminal size={18} />
              <span>
                Codex<small>桌面端 / CLI / IDE</small>
              </span>
            </button>
          </div>
          <label className="plugin-field">
            WorkHub 访问地址
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              aria-describedby="plugin-url-hint"
              aria-invalid={!parsed.success}
            />
          </label>
          <p className="plugin-hint" id="plugin-url-hint">
            填写 {isCodex ? "Codex" : "Claude"}
            可访问的站点根地址。仅用于本次打包，不修改服务器配置；OAuth
            需与服务器 PUBLIC_URL 一致。
          </p>
          <label className="plugin-field">
            连接认证
            <select
              value={authentication}
              disabled={target === "desktop"}
              onChange={(e) =>
                setAuthentication(
                  e.target.value as PluginDownloadInput["authentication"],
                )
              }
            >
              <option value="oauth">OAuth · 浏览器登录授权（推荐）</option>
              <option value="token">Token · 可限定到具体任务</option>
            </select>
          </label>
          <p className="plugin-hint">
            {authentication === "oauth" ? (
              "首次连接时登录 WorkHub，选择工作空间只读或读写权限。"
            ) : (
              <>
                先在 <Link to="/settings?tab=agents">Agent 接入</Link>{" "}
                创建任务凭证，再在本机设置 WORKHUB_TOKEN。下载包不包含凭证。
              </>
            )}
          </p>
          {!parsed.success && (
            <p className="plugin-validation" role="alert">
              {parsed.error.issues[0].message}
            </p>
          )}
          <Button
            onClick={() => void download()}
            disabled={!parsed.success || downloading}
          >
            <Download size={16} />
            {downloading ? "正在生成…" : "下载插件 ZIP"}
          </Button>
          <p className="plugin-hint plugin-security">
            <ShieldCheck size={14} />
            无需内置助手的 LLM Key · 不包含工作数据
          </p>
        </section>
        <section className="panel plugin-skills">
          <div className="plugin-section-heading">
            <h3>把流程变成 Skills</h3>
            <span className="muted">按需调用</span>
          </div>
          <div>
            {metadata.skills.map((skill, i) => (
              <div className="plugin-skill" key={skill.name}>
                <span className="plugin-skill-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{skill.title}</strong>
                  <p>{skill.description}</p>
                </div>
                <code>{skill.name}</code>
              </div>
            ))}
          </div>
          <p className="plugin-skill-footer">
            Agent 提交内容与证据，评审和验收仍由你掌握。
          </p>
        </section>
      </div>

      <section className="panel plugin-install">
        <div className="plugin-section-heading">
          <h3>三步开始协作</h3>
          <a
            href={
              isCodex
                ? "https://developers.openai.com/plugins/build/plugins"
                : target === "code"
                  ? "https://code.claude.com/docs/en/plugins"
                  : "https://support.claude.com/en/articles/13837440-use-plugins-in-claude"
            }
            target="_blank"
            rel="noreferrer"
          >
            官方安装说明 <ExternalLink size={13} />
          </a>
        </div>
        <ol className="plugin-steps">
          <li>
            <div>
              <strong>
                {target !== "desktop" ? "解压并安装" : "上传并启用"}
              </strong>
              {target !== "desktop" ? (
                <>
                  <p>
                    完整解压到固定目录，在{" "}
                    {isCodex ? "workhub-codex" : "workhub-marketplace"}
                    的上一级目录执行：
                  </p>
                  <div className="plugin-command">
                    <pre>
                      <code>{installCommands}</code>
                    </pre>
                    <button
                      className="icon-button"
                      aria-label="复制安装命令"
                      onClick={() => void copy(installCommands)}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  {isCodex && (
                    <p>
                      需要支持 plugin 命令的 Codex 版本。旧版 CLI 可按包内
                      README 使用 compat/skills 和直接 MCP
                      连接。两种方式选一种即可。
                    </p>
                  )}
                </>
              ) : (
                <p>
                  ZIP 无需解压。在 Claude 的 Customize → Plugins →
                  个人插件入口，通过「+ / 上传插件」添加文件并启用。Cowork
                  用户先进入 Cowork 标签页；入口名称随客户端版本变化。
                </p>
              )}
            </div>
          </li>
          <li>
            <div>
              <strong>
                {authentication === "oauth" ? "连接 WorkHub" : "设置本机凭证"}
              </strong>
              {authentication === "oauth" ? (
                <p>
                  {isCodex
                    ? "完全重启 Codex，在 MCP 设置中找到 WorkHub 插件的服务，点击认证并登录授权；CLI 用 /mcp 检查连接。安装后新建会话。"
                    : target === "code"
                      ? "重启 Claude Code，在 /mcp 中选择 workhub，按提示登录 WorkHub 并授权。"
                      : "按连接提示登录 WorkHub 并授权。远程连接需要外部可访问的 HTTPS 服务；如当前客户端没有插件上传入口，可使用新版客户端或 Claude Code 包。"}
                </p>
              ) : (
                <>
                  <p>
                    创建凭证后，在启动 {isCodex ? "Codex" : "Claude"}{" "}
                    的终端安全输入 Token。
                    {isCodex &&
                      "桌面端需要完全退出并从能继承该变量的环境启动；也可选择 OAuth。"}
                  </p>
                  <label className="plugin-shell">
                    终端
                    <select
                      value={shell}
                      onChange={(e) => setShell(e.target.value as typeof shell)}
                    >
                      <option value="powershell">PowerShell</option>
                      <option value="bash">Bash</option>
                    </select>
                  </label>
                  <div className="plugin-command">
                    <pre>
                      <code>{tokenCommand}</code>
                    </pre>
                    <button
                      className="icon-button"
                      aria-label="复制凭证配置命令"
                      onClick={() => void copy(tokenCommand)}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>
          <li>
            <div>
              <strong>从一个真实任务开始</strong>
              <p>
                先检查连接，再把任务交给适合的 Skill。将 TASK-001
                替换为你的任务编号。
              </p>
              <div className="plugin-example">
                <code>
                  {isCodex
                    ? "使用 WorkHub connect 连接 TASK-001"
                    : "/workhub:connect TASK-001"}
                </code>
                <span>用 WorkHub quality 分析这个任务的测试覆盖缺口。</span>
                <ArrowUpRight size={17} />
              </div>
            </div>
          </li>
        </ol>
        <details className="plugin-faq">
          <summary>更新、权限与连接排查</summary>
          {isCodex ? (
            <p>
              重新下载并替换原解压目录，再执行上方安装命令，重启并新建会话。兼容方式重新复制
              skills。完整步骤与切换安装方式的说明见包内 README。
            </p>
          ) : (
            <p>
              安装包内 README 包含完整步骤。Claude Code
              更新：替换原解压目录，执行{" "}
              <code>claude plugin marketplace update workhub-local</code> 和{" "}
              <code>
                claude plugin update workhub@workhub-local --scope user
              </code>
              ，然后重启；桌面端重新上传插件。
            </p>
          )}
          <p>
            OAuth 面向整个工作空间；需要隔离任务时，使用{" "}
            {isCodex ? "Codex" : "Claude Code"} Token 版。Agent
            不具备最终审批、拒绝、删除、豁免和验收权限。
          </p>
          {isCodex && (
            <p>
              私有 CA 需要在运行 Codex 的环境受信任；请勿直接套用 Claude 的
              NODE_EXTRA_CA_CERTS。检查证书与站点地址匹配后完全重启客户端。Windows
              与 WSL 的配置、证书和环境变量彼此独立。
            </p>
          )}
          <p>
            连接失败先核对网络、HTTPS 证书和 PUBLIC_URL；反向代理需要转发
            /mcp、/oauth/* 与 /.well-known/*。401 重新授权，403
            检查权限。修改服务器地址后请重新下载插件。
          </p>
        </details>
      </section>
    </div>
  );
}
