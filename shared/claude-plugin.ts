import { z } from "zod";

export const pluginSkills = [
  {
    name: "connect",
    title: "连接与上下文",
    description: "检查连接、定位任务，读取当前约束。",
  },
  {
    name: "intake",
    title: "想法与原则",
    description: "整理待办、归入任务，提出原则草稿。",
  },
  {
    name: "requirements",
    title: "需求与验收",
    description: "分组整理需求，拆解可验证的验收标准。",
  },
  {
    name: "design",
    title: "方案与决策",
    description: "维护多份设计文档，关联需求和原则。",
  },
  {
    name: "implement",
    title: "开发与问题",
    description: "跟进实施事项，回写进展与阻塞。",
  },
  {
    name: "quality",
    title: "测试与追溯",
    description: "关联测试用例，提交绑定版本的真实证据。",
  },
  {
    name: "status",
    title: "总结与报告",
    description: "读取覆盖矩阵，汇总进展和待处理事项。",
  },
] as const;

export const pluginDownloadSchema = z
  .object({
    target: z.enum(["code", "desktop", "codex"]),
    authentication: z.enum(["oauth", "token"]),
    baseUrl: z.string().trim().url("请填写完整的 WorkHub 地址").max(2048),
  })
  .strict()
  .superRefine((input, ctx) => {
    let url: URL;
    try {
      url = new URL(input.baseUrl);
    } catch {
      return;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      /\s|\\/.test(input.baseUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "请填写站点根地址，不包含账号、路径、查询参数或片段",
      });
    }
    if (
      url.protocol !== "https:" &&
      !(input.target !== "desktop" && loopback && url.protocol === "http:")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "远程连接需要 HTTPS；仅本机客户端连接支持 HTTP",
      });
    }
    if (input.target === "desktop" && loopback) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "Claude 桌面端需要可从外部访问的 HTTPS 地址，不能使用 localhost",
      });
    }
    if (input.target === "desktop" && input.authentication !== "oauth") {
      ctx.addIssue({
        code: "custom",
        path: ["authentication"],
        message: "桌面端插件使用浏览器 OAuth 授权",
      });
    }
  });

export type PluginDownloadInput = z.infer<typeof pluginDownloadSchema>;
export type PluginMetadata = {
  name: string;
  version: string;
  publicUrl: string;
  skills: typeof pluginSkills;
};

export const codeInstallCommands =
  "claude plugin marketplace add ./workhub-marketplace\nclaude plugin install workhub@workhub-local --scope user";
export const tokenPowerShell =
  '$env:WORKHUB_TOKEN = [System.Net.NetworkCredential]::new("", (Read-Host "WorkHub Token" -AsSecureString)).Password\nclaude';
export const tokenBash =
  'read -rsp "WorkHub Token: " WORKHUB_TOKEN; echo\nexport WORKHUB_TOKEN\nclaude';
