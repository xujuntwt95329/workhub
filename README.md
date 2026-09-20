# WorkHub

个人工程工作空间：把想法、需求、设计、实施、问题和验证证据放在一起，让人和 Agent 使用同一套结构化记录。适合部署到自己的服务器，从电脑和手机访问。

## 已实现

- 工作台、项目筛选、任务、轻量/标准流程、实施进度、全局搜索和活动记录。
- 紧凑可折叠的需求分组、拒绝列表、可恢复回收站、逐条验收标准、多份 Markdown 设计、版本历史和差异、当前版本确认、集中待处理入口。
- 测试用例（前置条件、步骤、预期结果）、追加式执行记录、需求—验收标准—用例—结果—问题双向追溯、CSV/Markdown/JSON 导出、报告快照与最终验收。
- 全局和任务内待办、归入既有任务、一键转新任务；任务内基本原则、采用的版本基线、必需原则的人工核对与依据记录。
- 内置助手：全局/任务问答、来源引用、任务摘要、变更后自动合并生成、持久化队列、取消与每日调用上限。配置自己的兼容 Chat Completions 协议的模型服务。
- 外部 Agent：REST API、JSON Schema、MCP；独立 Bearer Token 或 OAuth + PKCE；任务作用域、可撤销凭证、乐观锁和幂等请求。
- Claude 插件：设置页下载 Claude Code / 桌面端 ZIP，内置 7 个工程协作 Skills、MCP 配置、当前接口契约及安装说明。
- 单 Owner 登录、服务端权限、审计、密码哈希、API Key 加密、响应式 UI、本地中文字体。

本轮任务归属、追溯口径与历史数据升级说明见 [docs/task-traceability.md](docs/task-traceability.md)。列表支持搜索、分页和展开详情。

## 本机启动

需要 Node.js **22.12+** 和 npm。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>，创建自己的账户，可选载入知识库网站示例。没有默认账户或密码，首个账户创建后关闭初始化入口。

开发模式使用 **PGlite（嵌入式 PostgreSQL）**，无需另装数据库。数据在 `.data/postgres`，加密主密钥在 `.data/master.key`，两者均须保留。开发模式只监听本机。

```sh
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
```

本机浏览器测试使用已安装的 Chrome；CI 使用 Playwright Chromium。测试启动独立内存数据库和 `3101` 端口，不修改日常空间。覆盖率报告在 `coverage/index.html`，浏览器报告在 `playwright-report/index.html`，截图在 `artifacts/`。

## 服务器部署

需要 Docker Compose，并允许访问服务器的 TCP 80/443。公网访问使用指向服务器的域名；局域网也可直接使用服务器 IP，证书配置见下文。组合为 **Caddy HTTPS → WorkHub → PostgreSQL 17**，数据库和应用没有直接暴露宿主机端口。

1. 上传项目，复制 `.env.example` 为 `.env`。
2. 设置一致的 `DOMAIN` 与 `PUBLIC_URL`，例如 `workhub.example.com` 和 `https://workhub.example.com`，URL 不带末尾斜杠。
3. 运行 `node scripts/generate-secrets.mjs`，把三个生成值写入 `.env`。保护文件权限，另行备份 `KEY_ENCRYPTION_KEY`。
4. 启动：

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

5. 在浏览器打开 `.env` 中的 `PUBLIC_URL`，用 `SETUP_TOKEN` 初始化账户。正式使用建议不载入示例。

浏览器入口是 HTTPS 443（地址中可以省略端口），HTTP 80 自动跳转 HTTPS。`3001` 仅供容器内部通信，`5173` 仅用于本地开发，不能作为 Compose 部署的访问端口。

Caddy 管理 HTTPS 证书，PostgreSQL 使用持久化卷。生产模式强制要求数据库、加密主密钥、初始化密钥和 HTTPS 地址；Cookie 使用 HttpOnly、Secure、SameSite=Lax。

也可独立运行：设置 `DATABASE_URL`、`PUBLIC_URL`、`KEY_ENCRYPTION_KEY`、`SETUP_TOKEN`、`NODE_ENV=production` 后执行 `npm run build && npm start`，放在 HTTPS 反向代理之后。

### 局域网 IP 访问

例如，服务器 IP 为 `192.168.1.100` 时，`.env` 中填写以下纯文本（替换为实际 IP，不要使用 Markdown 链接）：

```dotenv
DOMAIN=192.168.1.100
PUBLIC_URL=https://192.168.1.100
```

运行 `docker compose up -d` 应用环境变量变更，从同一局域网或可访问该网络的 VPN 打开 `https://192.168.1.100`。Caddy 会为私有 IP 使用本地 CA 签发证书，需要在每台访问设备上信任该 CA。仓库中的 `default_sni` 配置用于客户端按 IP 访问、不发送 TLS 站点名称时选择正确证书，避免 Docker 网络地址与宿主机地址不同导致握手失败。

如果更新前已经启动过代理，拉取新配置后重建代理容器以重新读取挂载文件：

```sh
docker compose up -d --force-recreate proxy
```

在服务器项目目录导出 Caddy 的根证书：

```sh
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./workhub-root.crt
```

通过可信方式将 `workhub-root.crt` 复制到访问设备，导入系统或浏览器的受信任根证书存储。Windows 可双击证书，选择“安装证书 → 当前用户 → 将所有证书放入下列存储 → 受信任的根证书颁发机构”；其他系统或使用独立证书存储的浏览器按其证书管理界面导入。重启浏览器后再次访问。只需复制 `root.crt`，不要复制或分发 CA 私钥。参见 [Caddy Docker 本地 HTTPS 说明](https://caddyserver.com/docs/running#local-https-with-docker)。

访问失败时，在服务器项目目录执行：

```sh
docker compose ps -a
docker compose logs --tail=80 app proxy
curl -vk --connect-timeout 5 --max-time 10 https://192.168.1.100/health
```

将测试地址替换为实际服务器地址。`-k` 仅用于健康检查时区分证书信任与连接问题；正式访问仍需信任证书。返回 `{"status":"ok"}` 表示代理、应用和数据库可用；连接超时或拒绝连接时检查端口映射、容器状态和防火墙；TLS 握手失败时检查代理是否已加载更新后的 `default_sni`；返回 502 时查看应用日志。共享排查信息时只提供 `DOMAIN`、`PUBLIC_URL` 和必要日志，不要粘贴完整 `.env`。

### 备份和恢复

```sh
npm run backup
npm run backup -- backups/before-upgrade.dump
```

脚本通过二进制流调用 `pg_dump`，兼容 Windows/Linux，拒绝覆盖已有文件。数据库中包含加密后的模型 Key，恢复时必须保有对应主密钥。UI JSON 导出只适合业务归档，不包含凭证，不能代替完整备份。

恢复会替换当前内容。先备份当前数据库，再明确执行：

```sh
npm run restore -- backups/before-upgrade.dump --confirm-replace
```

脚本先停应用，单事务恢复成功后重启；失败保留停止状态。普通升级不要执行 `docker compose down -v`，该命令会删除持久化卷。

## Agent 接入

使用 Claude 时，可在「设置与接入 → Claude 插件」下载并按页面指引安装。插件涵盖连接、待办与原则、需求、设计、开发、测试追溯和总结；Code 支持 OAuth 或任务 Token，桌面端使用 OAuth。详细安装、权限和验证范围见 [docs/claude-plugin.md](docs/claude-plugin.md)。

在「设置与接入 → Agent 接入」为每个 Agent 创建独立凭证，限定任务和读写能力。Token 只显示一次，服务端只保存哈希。

- REST：`https://你的域名/api/v1`
- MCP Streamable HTTP：`https://你的域名/mcp`
- OpenAPI：`/api/openapi.json`，需登录。
- 类型与字段约束：`GET /api/v1/schema` 或 MCP 资源 `workhub://schema`。
- 操作说明：[docs/api-guide.md](docs/api-guide.md)。

CLI 可使用 `Authorization: Bearer <token>`。远程 MCP 客户端可添加 `/mcp` 并通过 OAuth 登录授权；支持动态注册、S256 PKCE、一次性授权码、刷新轮换与撤销。OAuth 提供全工作空间的只读/读写授权；任务级权限使用独立 Token。实际客户端兼容性仍需在目标客户端验证。

Agent 应先读取任务上下文，再写入结构化记录，最后请求评审。**Agent 不能批准、豁免、验收或降低已有门槛**。更新必须带读取过的 `expectedVersion`；409 冲突后重新读取并合并。重试同一个操作应保持 `Idempotency-Key` 不变。

## 质量口径

- 结果绑定完整 40 位 commit SHA、用例版本、验收标准版本和需求版本，采用服务器最后接收的记录。后续失败不会被旧通过覆盖；相关版本变化后显示「待复验」。
- 所有必需检查都通过才计为通过；没有必需检查、跳过、阻塞、执行错误均不算通过。
- 不适用需 Owner 确认和说明；豁免需理由并绑定版本和代码，单独统计，不增加通过率。
- 验收检查确认版本、必需设计、实施事项、阻塞问题/疑问、当前证据与必需原则核对，再原子完成任务并保存报告。

平台管理 Agent/人工提交的证据及适用版本，目前不会连接 CI 核验日志真伪，也不会自行运行你的项目测试。

## 内置助手

填写 API 地址（如 `https://provider.example/v1`）、模型 ID 和 API Key。Key 以 AES-256-GCM 加密，不出现在普通导出、前端查询和日志中。选定范围的工程资料会发送到所配置的模型提供方。

自动概览在同一任务静默约 30 秒后合并生成；旧摘要保留并标识过期。队列每 2 秒检查，支持租约恢复，每日调用次数上限按 UTC 日计算。

默认连接公开 HTTPS 地址。内网模型需在 `.env` 的 `LLM_ALLOWED_ORIGINS` 明确列出完整 origin，例如 `http://ollama:11434`。容器中的 localhost 指向容器本身。

当前助手只读问答和总结，不代替审批，也不修改工程数据。未配置模型时，工程管理与确定性报告仍可正常使用。

## 工程与验证边界

`src/` 是 React UI，`shared/domain.ts` 是纯业务规则，`server/` 是 Fastify/数据库/助手/MCP，`tests/` 包含单元、集成、协议与 UI 测试，`deploy/` 和 `scripts/` 提供部署运维。

覆盖率统计包含 `shared/`、`server/` 与 `src/lib/`，排除启动入口和示例种子；UI 另有组件测试与端到端测试，服务端覆盖率不能理解为全 UI 行覆盖率。

CI 另提供独立 PostgreSQL 测试和镜像构建。当前环境已验证本地路径；镜像、目标服务器 HTTPS、真实模型和特定远程客户端仍需在部署环境验证。

首版是个人单工作空间，暂未实现多人协作、附件存储、Git/CI 自动同步、向量检索、助手自主写入与长期多轮记忆。完整状态见 [docs/implementation-status.md](docs/implementation-status.md)。
