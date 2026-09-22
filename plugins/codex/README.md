# Codex 插件模板

`workhub/.codex-plugin/plugin.json` 是 Codex 清单模板，`.mcp.json` 提供本机示例。完整安装包由 `server/codex-plugin.ts` 生成，合并与 Claude 共用的 Skills、参考协议、当前接口契约、选定服务地址和认证方式；不要直接安装这个模板目录。

在设置页选择 Codex 下载，或运行：

```sh
node --import tsx scripts/build-codex-plugin.ts https://hub.example
```

安装和权限说明见 [Codex 插件文档](../../docs/codex-plugin.md)。
