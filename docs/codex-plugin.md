# Codex 插件

日期：2026-09-22；插件版本：0.1.0。

在 **设置与接入 → Agent 插件 → Codex**（`/settings?tab=plugins`）填写 Codex 所在设备能访问的 WorkHub 根地址，选择 OAuth 或 Token，再下载 ZIP。无需配置 WorkHub 内置助手的 LLM API Key。

## 内容与权限

包内提供 7 个 Skills：连接、待办与原则、需求与验收、设计、开发与问题、质量追溯、总结与报告。它们与 Claude 包共用经过评审的内容和协议；下载时加入当前服务器的完整记录契约。MCP 提供 10 个工程工具，包括重点关注和任务待办归属。

Agent 可以读取上下文、提交草稿、请求评审、回写进度及真实测试证据。批准、拒绝、删除、原则采用、豁免和最终验收由 Owner 完成。OAuth 覆盖工作空间；需要限定某个任务时，选择 Token 并在「Agent 接入」创建相应凭证。包中不包含任务数据、Token、API Key 或安装时自动执行的脚本。

## 原生插件安装

完整解压 ZIP 到固定目录，在 `workhub-codex` 的上一级执行：

```sh
codex plugin marketplace add ./workhub-codex
codex plugin add workhub@workhub-codex-local
```

完全重启 Codex，在插件页确认 WorkHub 已启用，并新建会话。桌面版与 CLI 需要使用同一主机、同一用户的 Codex 配置；Windows 与 WSL 的安装彼此独立。

OAuth 版：在 Codex 的 MCP 设置中找到 WorkHub 插件的服务，点击认证，登录 WorkHub 并授权。CLI 可通过 `/mcp` 检查连接；带插件前缀的服务名称以客户端显示为准。

Token 版：按设置页或包内 README 的 PowerShell/Bash 指引，安全输入 `WORKHUB_TOKEN` 后从该终端启动 Codex。原生 `.mcp.json` 使用 `bearer_token_env_var: "WORKHUB_TOKEN"`，由 Codex 读取环境变量。桌面版若已运行，需要完全退出，并从能继承该变量的环境启动；不方便配置环境变量时使用 OAuth。

在新会话中可以说：「使用 WorkHub connect 连接 TASK-001，先读取上下文」；「使用 WorkHub requirements 整理需求并提交评审」；「使用 WorkHub quality 分析测试覆盖缺口」。将编号替换为你的任务，也可通过技能选择器选择 `workhub:connect` 等技能。

安装结构采用受支持的 `.codex-plugin/plugin.json` 兼容格式，独立 marketplace 位于 `.agents/plugins/marketplace.json`。参见 [OpenAI 插件打包与安装文档](https://developers.openai.com/plugins/build/plugins) 和 [Codex MCP 文档](https://developers.openai.com/codex/mcp)。

## 旧版 CLI 的兼容方式

先检查 `codex plugin --help`。若不支持该子命令，可以更新 Codex，或按包内 README 复制 `compat/skills/workhub-*` 到 `~/.agents/skills/`，并通过 `codex mcp add workhub --url ...` 添加直接 MCP 连接。Token 使用 `--bearer-token-env-var WORKHUB_TOKEN`，OAuth 添加后执行 `codex mcp login workhub`。README 已根据下载地址生成可复制的命令。

兼容 Skills 使用 `workhub-` 前缀，每个技能自带相对路径正确的协议与契约。通过 `/skills` 检查技能，使用 `workhub-connect`、`workhub-quality` 等名称。原生插件与兼容方式选一种，避免重复加载工具。

## 更新与连接排查

重新下载并替换原解压目录，再执行上述两条安装命令，重启并新建会话。同版本更新 MCP 地址的重新安装已在隔离配置中验证。兼容方式重新复制对应的 Skills；地址或认证方式变化时重新配置 MCP。

切换安装方式前，先移除原方式：原生插件使用 `codex plugin remove workhub@workhub-codex-local`；直接 MCP 使用 `codex mcp remove workhub`，再按需移除兼容方式安装的 `workhub-*` 技能。当前使用固定插件/服务名称，多个 WorkHub 实例不支持同时安装为不同实例。

- OAuth 要求服务器 `PUBLIC_URL` 与打包地址一致，代理转发 `/mcp`、`/oauth/*`、`/.well-known/*`。
- 私有 CA 要在运行 Codex 的设备和环境中受信任，证书应匹配访问地址。不要将 Claude 的 `NODE_EXTRA_CA_CERTS` 设置当作 Codex 已信任证书的证明，也不要关闭证书校验。
- 401 重新授权或更新 Token；403 检查任务及读写范围；409 重读最新版本。
- 安装包只接受根地址，不允许账号、路径、查询参数和片段。远程服务要求 HTTPS；本机 loopback 可用 HTTP。

## API 与离线打包

仅 Owner 可调用，沿用会话登录和请求来源校验：

- `GET /api/plugins/codex`：名称、版本、服务器 `PUBLIC_URL` 和 Skills 清单。
- `POST /api/plugins/codex/download`：`{"target":"codex","authentication":"oauth","baseUrl":"https://hub.example"}`。认证可改为 `token`；未知字段及错误客户端类型被拒绝。
- 响应为 ZIP，带 `Cache-Control: private, no-store`、下载文件名与 `X-Content-SHA256`。相同配置生成相同字节内容。

开发者可运行 `node --import tsx scripts/build-codex-plugin.ts https://hub.example` 离线打包；输出在忽略提交的 `artifacts/codex-plugin/oauth/` 和 `token/` 中。

## 验证范围

- Codex CLI `0.155.0-alpha.9.2`：隔离配置下完成 marketplace 注册、插件安装、7 个 Skills 识别、10 个 MCP 工具发现、Token 握手、OAuth 动态注册与回调、在线契约读取；同版本更新地址后重新安装成功。未发起模型调用，未改动用户 Codex 配置。
- 插件校验器验证清单与相对路径；7 个兼容 Skills 通过 `quick_validate`。单元测试验证两种认证包、原生/兼容布局、共享内容一致、契约同步、内部链接、可复现 ZIP、权限及输入边界。
- 浏览器验证真实下载、客户端切换、安装指引、390px 手机布局和 WCAG A/AA。目标 Linux/macOS 客户端和用户服务器私有 CA 仍需在对应环境完成连接验证。
