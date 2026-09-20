# WorkHub Claude 插件源码

`workhub/` 包含正式插件清单、7 个 Skills 和共用协作协议。面向 Claude 插件格式，不使用 Codex 插件清单。

生产下载由 `server/claude-plugin.ts` 按文件白名单生成 ZIP：写入所选站点的 `.mcp.json`、当前 API 契约和安装说明。Claude Code 包另包含本地 marketplace；桌面端包直接以插件内容作为 ZIP 根目录。任何密钥和工程数据都不进入包。

不要直接分发本源码目录：源码中的 MCP 使用 WORKHUB_URL 环境变量，离线 `references/record-schema.json` 由打包器从服务器契约生成。

在项目根目录离线生成：

```sh
node --import tsx scripts/build-claude-plugin.ts https://your-workhub.example
```

产物位于 `artifacts/claude-plugin/`。日常用户在「设置 → Claude 插件」中下载和阅读安装说明。维护时同时更新 Skills、接口契约测试与插件版本。具体设计和验证见 `docs/claude-plugin.md`。
