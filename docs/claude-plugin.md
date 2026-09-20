# Claude 插件

日期：2026-09-20；插件版本：0.1.1。

在 **设置与接入 → Claude 插件**（`/settings?tab=plugins`）选择客户端、WorkHub 地址和认证方式，再下载 ZIP。页面提供安装步骤、命令复制、权限说明和连接排查。安装包也包含相同用途的 README。

## 插件内容

| Skill                   | 用途                                             |
| ----------------------- | ------------------------------------------------ |
| `/workhub:connect`      | 检查 MCP 连接、读取契约、定位任务与上下文，只读  |
| `/workhub:intake`       | 整理全局/任务待办、归入既有任务、原则草稿        |
| `/workhub:requirements` | 需求分组、可验证的验收标准、版本评审             |
| `/workhub:design`       | 多份设计、方案取舍、采用的原则基线               |
| `/workhub:implement`    | 实施进度、代码开发交接、问题关联                 |
| `/workhub:quality`      | 多对多用例关联、真实执行、精确版本证据、覆盖缺口 |
| `/workhub:status`       | 任务/工作空间问答、进度与覆盖总结，只读          |

这些是按场景加载的协作指引，不会在安装时自动启动 Agent。MCP 的 9 个工具负责读取和写入结构化记录；公共引用文件定义权限、幂等重试、版本冲突及质量证据规则。下载时生成 `references/record-schema.json`，始终与当前服务器契约一致，在线 `workhub://schema` 优先。

记录正文只提供工程背景，不能作为新的工具授权。Agent 不批准、拒绝、删除、恢复、豁免、采用/核对原则或最终验收，不通过降级门槛改善覆盖数字。测试结果必须来自真实运行，绑定当时的需求、验收标准、用例版本和完整 commit SHA；无法执行时说明阻塞，不制造通过证据。

## Claude Code

ZIP 内带一个本地 marketplace。完整解压到固定位置，在 `workhub-marketplace` 的上一级目录运行：

```sh
claude plugin marketplace add ./workhub-marketplace
claude plugin install workhub@workhub-local --scope user
```

重启 Claude Code，在 `/plugin` 检查启用状态，在 `/mcp` 连接。OAuth 版会引导浏览器登录 WorkHub；Token 版需要先在 WorkHub 的 Agent 接入页创建凭证，再通过启动终端设置 `WORKHUB_TOKEN`。设置页提供 PowerShell 和 Bash 的安全输入命令，凭证不会进入命令历史文本或插件包。

例如，先输入 `/workhub:connect TASK-001`，再要求「用 WorkHub quality 分析这个任务的测试覆盖缺口」。将示例编号换成实际任务。安装命令与命名空间遵循 [Claude Code 插件文档](https://code.claude.com/docs/en/plugins) 和 [Marketplace 文档](https://code.claude.com/docs/en/plugin-marketplaces)。

更新时重新下载并替换原解压目录，再执行：

```sh
claude plugin marketplace update workhub-local
claude plugin update workhub@workhub-local --scope user
```

随后重启客户端。此流程已在 Claude Code 2.1.267 的独立测试配置中验证，包括同版本切换 MCP 地址后更新配置。多个 WorkHub 实例当前共用 `workhub-local` / `workhub` 名称，重新安装会切换连接目标；首版不提供多实例并存。

## Claude 桌面端 / Cowork

选择桌面端后下载的是标准插件 ZIP，插件清单直接位于 ZIP 根目录的 `.claude-plugin/plugin.json`，无需解压。在 Claude 的 Customize → Plugins 个人插件入口，通过「+ / 上传插件」添加并启用。Cowork 先进入对应标签页，具体入口名称取决于客户端版本与账户提供的能力。参见 [Claude 个人插件说明](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)。

桌面端包使用 OAuth，要求外部连接服务可访问的 HTTPS 地址。浏览器/桌面端远程连接无法通过 localhost 访问你的开发电脑。当前没有上传入口时，可使用支持个人插件的新版客户端或 Claude Code 包。桌面端的实际账号上传、授权仍需在目标客户端验证；没有声称已进行此项实测。

## 地址、权限与部署

- 默认地址来自服务端 `PUBLIC_URL`，不信任 HTTP Host 请求头。页面中的改动仅用于本次打包，不改变服务器配置。
- 只接受站点根地址。拒绝 URL 中的账号密码、路径、查询参数、片段和空白；远程地址必须为 HTTPS。仅 Code 本机连接支持 HTTP loopback。
- OAuth 的部署地址要与服务器 `PUBLIC_URL` 一致。反向代理转发 `/mcp`、`/oauth/*`、`/.well-known/*`，并提供可信 HTTPS 证书。
- OAuth 授权范围为整个工作空间，只读或读写；任务隔离使用 Code Token 版与限定任务凭证。Token 版只写入字面量 `Bearer ${WORKHUB_TOKEN}`，由客户端解析环境变量。参见 [Claude Code MCP 配置](https://code.claude.com/docs/en/mcp)。
- 不需要配置 WorkHub 内置助手的 LLM API Key；模型和工具执行由使用的 Claude 客户端提供。
- 401 重新授权或更新 Token；403 检查任务/读写权限；409 重读版本；网络错误检查地址和证书。

## 下载接口与打包

两个接口都只允许 Owner，会话登录与既有请求来源校验继续生效：

- `GET /api/plugins/claude`：名称、版本、服务端站点地址、Skills 清单。
- `POST /api/plugins/claude/download`：生成 ZIP；严格校验输入，未知字段被拒绝。

```json
{
  "target": "code",
  "authentication": "oauth",
  "baseUrl": "https://your-workhub.example"
}
```

`target` 为 `code` 或 `desktop`；`authentication` 为 `oauth` 或 `token`，桌面端仅 OAuth。响应为 `application/zip`，带附件文件名、`Cache-Control: private, no-store`、`X-Content-SHA256`。

打包器只读取显式允许的插件文件，补充 MCP 配置、安装说明和当前契约。不递归打包工作区，不访问数据库，不读取环境凭证，不抓取用户输入的地址。使用 fflate 与固定时间戳生成可复现 ZIP。Docker 运行阶段已包含 `plugins/` 资产。

源码在 `plugins/claude/workhub/`，离线构建入口为：

```sh
node --import tsx scripts/build-claude-plugin.ts https://your-workhub.example
```

生成 `artifacts/claude-plugin/` 中的两个包；不传 HTTPS 地址时仅生成 Code 本机包。不要直接分发源码文件夹，离线契约与部署地址由打包器补齐。

## 验证边界

- 单元/接口测试验证两种布局、内部引用、生成契约、可复现性、URL 校验、Owner/Agent 权限、来源校验、凭证排除、下载错误及页面模式切换。
- 使用插件中的质量示例通过官方 MCP SDK 回放，验证版本绑定、幂等重放、最新失败口径及过期需求证据拒绝；它是测试夹具，不是真实项目测试记录。
- Python 标准库独立解压并验证 ZIP CRC；7 个 Skills 通过 skill-creator 的 quick_validate 检查；两个插件清单及 marketplace 通过 Claude Code 2.1.267 `plugin validate --strict --json`，无错误或警告。
- 在项目产物目录指定独立 `CLAUDE_CONFIG_DIR`，实际添加 marketplace、安装并更新插件，确认 MCP 配置被识别；没有修改个人 Claude 配置，没有模型调用。
- 浏览器验证实际下载、两种客户端模式、凭证指引、移动交互、无横向溢出及 WCAG A/AA 自动检查。截图在 `artifacts/claude-plugin-desktop.png`、`artifacts/claude-plugin-mobile.png`。
- 尚未用真实 Claude 账号测试 OAuth 完整登录或桌面端上传，也未验证模型实际选择 Skill 的效果。总体测试与覆盖率见 [verification.md](verification.md)。
