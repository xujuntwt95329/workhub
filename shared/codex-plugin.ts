import {
  pluginDownloadSchema,
  type PluginDownloadInput,
} from "./claude-plugin.js";

export const codexPluginDownloadSchema = pluginDownloadSchema
  .refine((v) => v.target === "codex", "请选择 Codex 客户端")
  .refine((v) => {
    try {
      return /^[a-zA-Z0-9.:[\]_-]+$/.test(new URL(v.baseUrl).hostname);
    } catch {
      return false;
    }
  }, "请填写有效的主机名或 IP 地址");
export const codexInstallCommands =
  "codex plugin marketplace add ./workhub-codex\ncodex plugin add workhub@workhub-codex-local";
export const codexTokenPowerShell =
  '$env:WORKHUB_TOKEN = [System.Net.NetworkCredential]::new("", (Read-Host "WorkHub Token" -AsSecureString)).Password\ncodex';
export const codexTokenBash =
  'read -rsp "WorkHub Token: " WORKHUB_TOKEN; echo\nexport WORKHUB_TOKEN\ncodex';
export function codexMcpCommand(input: PluginDownloadInput) {
  const value = codexPluginDownloadSchema.parse(input);
  return `codex mcp add workhub --url '${new URL(value.baseUrl).origin}/mcp'${value.authentication === "token" ? " --bearer-token-env-var WORKHUB_TOKEN" : ""}`;
}
