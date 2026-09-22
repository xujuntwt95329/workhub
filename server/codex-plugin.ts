import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { authorize } from "../shared/domain.js";
import {
  pluginSkills,
  type PluginDownloadInput,
} from "../shared/claude-plugin.js";
import {
  codexPluginDownloadSchema,
  codexInstallCommands,
  codexMcpCommand,
  codexTokenBash,
  codexTokenPowerShell,
} from "../shared/codex-plugin.js";
import { engineeringAssets } from "./plugin-assets.js";
import { recordContract } from "./contract.js";

const manifestText = readFileSync(
  new URL(
    "../plugins/codex/workhub/.codex-plugin/plugin.json",
    import.meta.url,
  ),
  "utf8",
);
const manifest = JSON.parse(manifestText) as { name: string; version: string };
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function codexPluginReadme(input: PluginDownloadInput) {
  return `# WorkHub for Codex · ${manifest.version}

连接地址：${new URL(input.baseUrl).origin}/mcp
认证方式：${input.authentication === "oauth" ? "OAuth 浏览器授权" : "WORKHUB_TOKEN 环境变量"}

## 安装插件

1. 完整解压 ZIP 到固定目录，保留 workhub-codex 文件夹。终端进入它的上一级目录。
2. 使用支持 plugin 命令的 Codex CLI 执行：

\`\`\`sh
${codexInstallCommands}
\`\`\`

3. 完全重启 Codex，在插件页确认 WorkHub 已启用，并新建会话加载 Skills 和 MCP。桌面版和 CLI 必须使用同一台主机、同一用户的 Codex 配置；WSL 与 Windows 是不同环境。
${
  input.authentication === "oauth"
    ? "4. 在 Codex 的 MCP 设置中找到插件提供的 workhub 服务，点击认证并登录 WorkHub，选择只读或读写权限。CLI 使用 /mcp 查看连接；插件服务可能有前缀，以客户端实际显示的名称为准。"
    : `4. 在 WorkHub「设置 → Agent 接入」创建任务凭证。在启动 Codex 的终端输入 Token：

PowerShell:
\`\`\`powershell
${codexTokenPowerShell}
\`\`\`

Bash:
\`\`\`bash
${codexTokenBash}
\`\`\`

Token 只进入该终端和子进程。桌面版如已运行，需要退出后从能继承该变量的环境启动；不便设置环境变量时选择 OAuth 版。不要把 Token 发给模型或写进仓库。`
}

## 旧版 CLI 的兼容安装

若 codex plugin --help 不支持 plugin 子命令，可以更新 Codex，或使用包内 compat/skills 加上直接 MCP 连接。两种安装方式选一种，避免重复工具和 Skills。兼容包中的 Skill 名称加 workhub- 前缀并带独立参考文件。

在 ZIP 解压目录的上一级执行（仅复制 workhub-* 技能，重复执行会更新同名 WorkHub 技能）：

PowerShell:
\`\`\`powershell
New-Item -ItemType Directory -Force -Path "$HOME/.agents/skills" | Out-Null
Copy-Item -Path "./workhub-codex/compat/skills/workhub-*" -Destination "$HOME/.agents/skills" -Recurse -Force
${codexMcpCommand(input)}
\`\`\`

Bash:
\`\`\`bash
mkdir -p "$HOME/.agents/skills"
cp -R ./workhub-codex/compat/skills/workhub-* "$HOME/.agents/skills/"
${codexMcpCommand(input)}
\`\`\`

${input.authentication === "oauth" ? "然后执行 codex mcp login workhub，在浏览器登录授权。" : "然后按上文设置 WORKHUB_TOKEN。"} 重启 Codex 并新建会话。使用 codex mcp list 检查连接配置，使用 /skills 检查 Skills；例如明确要求使用 workhub-connect 或 workhub-quality。

## 开始工作

在对话中说：「使用 WorkHub connect，连接 TASK-001，先读取上下文」；「使用 WorkHub requirements 整理这个任务的需求，提交评审」；「使用 WorkHub quality 检查测试覆盖缺口」。TASK-001 替换为实际编号。也可用技能选择器选择对应技能，无需使用 Claude 的斜杠命令语法。

${pluginSkills.map((s) => `- ${s.name}：${s.title}。${s.description}`).join("\n")}

插件使用现有 MCP 接口，不需要 WorkHub 内置助手的 LLM API Key。OAuth 是工作空间权限；需要任务隔离时选择 Token。Agent 能提交草稿、开发进展、关注标记和真实测试证据，最终批准、拒绝、删除、原则采用、豁免和验收仍由 Owner 操作。

## 更新与排查

重新下载并替换原解压目录，执行上述 marketplace add 和 plugin add，再重启并新建会话。兼容方式重新复制 skills 即可；地址或认证方式变化时重新配置 MCP。切换安装方式前先移除旧方式：原生插件用 codex plugin remove workhub@workhub-codex-local；直接 MCP 用 codex mcp remove workhub，再按需移除兼容方式安装的 workhub-* 技能。

401 重新授权；403 检查任务和读写范围；409 重读记录版本。OAuth 要求服务器 PUBLIC_URL 与下载时填写的地址一致，反向代理转发 /mcp、/oauth/*、/.well-known/*。
HTTPS 私有 CA 必须在运行 Codex 的环境受信任。curl 成功不保证 Codex 已信任同一 CA；不要直接套用 Claude 的 NODE_EXTRA_CA_CERTS，也不要关闭证书校验。检查系统证书安装、证书地址是否匹配，或使用受信任证书，然后完全重启客户端。

本包仅包含技能、接口契约、MCP 地址和安装说明，不含任务数据、API Key 或 Token，不包含安装时自动执行的脚本。

官方参考：[插件格式与 marketplace](https://developers.openai.com/plugins/build/plugins)、[MCP 配置与认证](https://developers.openai.com/codex/mcp)。
`;
}

export function buildCodexPlugin(raw: unknown) {
  const input = codexPluginDownloadSchema.parse(raw);
  const readme = codexPluginReadme(input);
  const referenceFiles = {
    "references/protocol.md": engineeringAssets["references/protocol.md"],
    "references/quality-evidence.md":
      engineeringAssets["references/quality-evidence.md"],
    "references/record-schema.json": json(recordContract),
  };
  const files: Record<string, string> = {
    ...engineeringAssets,
    ...referenceFiles,
    ".codex-plugin/plugin.json": manifestText,
    ".mcp.json": json({
      mcpServers: {
        workhub: {
          type: "http",
          url: new URL(input.baseUrl).origin + "/mcp",
          ...(input.authentication === "token"
            ? { bearer_token_env_var: "WORKHUB_TOKEN" }
            : {}),
        },
      },
    }),
    "README.md": readme,
  };
  const archive: Zippable = {};
  const add = (name: string, content: string) => {
    archive["workhub-codex/" + name] = [
      strToU8(content),
      { mtime: new Date(2026, 0, 1) },
    ];
  };
  for (const [path, content] of Object.entries(files))
    add("plugins/workhub/" + path, content);
  add(
    ".agents/plugins/marketplace.json",
    json({
      name: "workhub-codex-local",
      interface: { displayName: "WorkHub" },
      plugins: [
        {
          name: "workhub",
          source: { source: "local", path: "./plugins/workhub" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    }),
  );
  add("README.md", readme);
  for (const skill of pluginSkills) {
    const prefix = `compat/skills/workhub-${skill.name}/`;
    add(
      prefix + "SKILL.md",
      engineeringAssets[`skills/${skill.name}/SKILL.md`]
        .replace(`name: ${skill.name}`, `name: workhub-${skill.name}`)
        .replaceAll("../../references/", "./references/"),
    );
    for (const [path, content] of Object.entries(referenceFiles))
      add(prefix + path, content);
  }
  const buffer = Buffer.from(zipSync(archive, { level: 6 }));
  return {
    buffer,
    filename: `workhub-codex-${manifest.version}.zip`,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function codexPluginRoutes(app: FastifyInstance, publicUrl: string) {
  app.get("/api/plugins/codex", async (req) => {
    authorize(req.actor, "configure");
    return {
      name: manifest.name,
      version: manifest.version,
      publicUrl,
      skills: pluginSkills,
    };
  });
  app.post("/api/plugins/codex/download", async (req, reply) => {
    authorize(req.actor, "configure");
    const artifact = buildCodexPlugin(req.body);
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
