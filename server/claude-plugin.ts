import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { authorize } from "../shared/domain.js";
import {
  pluginDownloadSchema,
  pluginSkills,
  codeInstallCommands,
  tokenPowerShell,
  tokenBash,
  type PluginDownloadInput,
} from "../shared/claude-plugin.js";
import { recordContract } from "./contract.js";

const root = new URL("../plugins/claude/workhub/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL(".claude-plugin/plugin.json", root), "utf8"),
) as { name: string; version: string };
// Explicit allowlist: downloading a plugin must never collect application data or secrets.
const assetPaths = [
  ".claude-plugin/plugin.json",
  ...pluginSkills.map((s) => `skills/${s.name}/SKILL.md`),
  "references/protocol.md",
  "references/quality-evidence.md",
];
const assets = Object.fromEntries(
  assetPaths.map((path) => [path, readFileSync(new URL(path, root), "utf8")]),
);
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function pluginReadme(input: PluginDownloadInput) {
  const url = new URL(input.baseUrl).origin;
  return `# WorkHub for Claude · ${manifest.version}

连接地址：${url}/mcp
身份认证：${input.authentication === "oauth" ? "OAuth 浏览器授权" : "WORKHUB_TOKEN 环境变量"}

## 安装

${
  input.target === "code"
    ? `1. 将 ZIP 完整解压到固定目录，保留 workhub-marketplace 文件夹。终端进入该文件夹的上一级。
2. 执行：

\`\`\`sh
${codeInstallCommands}
\`\`\`

3. 重启 Claude Code。在 /plugin 检查 WorkHub 已启用，在 /mcp 检查连接。
${
  input.authentication === "token"
    ? `4. 在 WorkHub「设置 → Agent 接入」创建凭证（可限定任务，需要写入时勾选写权限）。在启动 Claude 的终端设置环境变量，凭证只输入到本机提示中：

PowerShell:
\`\`\`powershell
${tokenPowerShell}
\`\`\`

Bash:
\`\`\`bash
${tokenBash}
\`\`\`

环境变量只对该终端及子进程生效。退出后可清除；不要放到仓库或聊天记录。`
    : "4. 在 /mcp 中选择 workhub，打开浏览器登录 WorkHub 并授权。"
}

临时试用也可以运行 claude --plugin-dir ./workhub-marketplace/plugins/workhub。
更新时重新下载并替换原目录，执行 claude plugin marketplace update workhub-local 和 claude plugin update workhub@workhub-local --scope user，然后重启。`
    : `1. 下载 ZIP，无需解压。在 Claude 的 Customize → Plugins 中，通过个人插件的「+ / 上传插件」选择 ZIP（入口名称可能随版本变化）。Cowork 用户先进入 Cowork 标签页。
2. 启用插件，并按连接提示打开 WorkHub 登录和授权。如果当前客户端不提供 ZIP 上传，请使用支持个人插件的新版客户端，或改用 Claude Code 包。
3. 服务器须有客户端连接服务可访问的 HTTPS 地址；localhost 仅代表连接方自身，无法访问你的电脑。
4. 更新时重新下载并在个人插件入口上传替换。`
}

## 开始使用

先运行 /workhub:connect TASK-001（替换为已有任务编号），或让 Claude「连接 WorkHub，列出我可访问的任务」。然后按工作场景使用：

${pluginSkills.map((s) => `- /workhub:${s.name}：${s.title}。${s.description}`).join("\n")}

例如：「用 WorkHub requirements 整理 TASK-001 的需求，按模块分组，提交我评审」；「用 WorkHub quality 分析 TASK-001 的缺口，已有执行证据才回写测试结果」。桌面端也可在对话中指明对应 Skill。

## 权限与配置

插件通过 MCP 访问现有 WorkHub API，不需要 WorkHub 内置助手的 LLM API Key。模型费用与执行能力由你使用的 Claude 客户端决定。
OAuth 权限覆盖工作空间；Claude Code 如需任务隔离，选择 Token 版并创建限定任务的凭证。Agent 可以提交草稿和执行证据，最终评审、拒绝、删除、原则采用、豁免和验收由 Owner 在 WorkHub 完成。
此包只包含技能、协议、数据结构和服务地址，不包含任何 Token、API Key、任务内容或自动执行脚本。
OAuth 部署要求服务器 PUBLIC_URL 与上述站点地址一致，并由反向代理将 /mcp、/oauth/* 和 /.well-known/* 转发给 WorkHub。
401 请重新授权或更新 Token；403 请检查授权范围；409 重读版本；连接失败先确认 URL、证书及网络。
详见 references/protocol.md 与 references/quality-evidence.md；references/record-schema.json 随当前服务器契约生成，在线 workhub://schema 优先。

## 官方参考

- Claude Code 插件：https://code.claude.com/docs/en/plugins
- 本地 Marketplace：https://code.claude.com/docs/en/plugin-marketplaces
- MCP 配置：https://code.claude.com/docs/en/mcp
- Claude 个人插件：https://support.claude.com/en/articles/13837440-use-plugins-in-claude
`;
}

export function buildClaudePlugin(raw: unknown) {
  const input = pluginDownloadSchema.parse(raw);
  const baseUrl = new URL(input.baseUrl).origin;
  const prefix =
    input.target === "code" ? "workhub-marketplace/plugins/workhub/" : "";
  const files: Record<string, string> = {
    ...assets,
    ".mcp.json": json({
      mcpServers: {
        workhub: {
          type: "http",
          url: baseUrl + "/mcp",
          ...(input.authentication === "token"
            ? { headers: { Authorization: "Bearer ${WORKHUB_TOKEN}" } }
            : {}),
        },
      },
    }),
    "references/record-schema.json": json(recordContract),
    "README.md": pluginReadme(input),
  };
  const archive: Zippable = {};
  // Fixed timestamp gives reproducible archives and hashes for the same configuration.
  const add = (name: string, text: string) => {
    archive[name] = [strToU8(text), { mtime: new Date(2026, 0, 1) }];
  };
  for (const [name, content] of Object.entries(files))
    add(prefix + name, content);
  if (input.target === "code") {
    add(
      "workhub-marketplace/.claude-plugin/marketplace.json",
      json({
        name: "workhub-local",
        description: "WorkHub 个人工程协作插件",
        owner: { name: "WorkHub" },
        plugins: [
          {
            name: manifest.name,
            source: "./plugins/workhub",
            version: manifest.version,
            description: "WorkHub 工程协作技能与 MCP 连接",
          },
        ],
      }),
    );
    add("workhub-marketplace/README.md", files["README.md"]);
  }
  const buffer = Buffer.from(zipSync(archive, { level: 6 }));
  return {
    buffer,
    filename: `workhub-claude-${input.target}-${manifest.version}.zip`,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function claudePluginRoutes(app: FastifyInstance, publicUrl: string) {
  app.get("/api/plugins/claude", async (req) => {
    authorize(req.actor, "configure");
    return {
      name: manifest.name,
      version: manifest.version,
      publicUrl,
      skills: pluginSkills,
    };
  });
  app.post("/api/plugins/claude/download", async (req, reply) => {
    authorize(req.actor, "configure");
    const artifact = buildClaudePlugin(req.body);
    return reply
      .type("application/zip")
      .header("Cache-Control", "private, no-store")
      .header(
        "Content-Disposition",
        `attachment; filename="${artifact.filename}"`,
      )
      .header("X-Content-SHA256", artifact.sha256)
      .send(artifact.buffer);
  });
}
