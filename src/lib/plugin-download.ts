import type { PluginDownloadInput } from "../../shared/claude-plugin";
import { ApiError } from "./api";

export async function fetchPlugin(input: PluginDownloadInput) {
  const client = input.target === "codex" ? "codex" : "claude";
  const response = await fetch(`/api/plugins/${client}/download`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error?.message ?? "插件下载失败，请稍后重试",
      body.error?.code ?? "DOWNLOAD_ERROR",
      response.status,
    );
  }
  if (
    response.headers.get("Content-Type")?.split(";")[0] !== "application/zip"
  ) {
    throw new Error("服务器未返回插件 ZIP，请检查部署配置");
  }
  const filename =
    response.headers
      .get("Content-Disposition")
      ?.match(
        /filename="(workhub-(?:claude-(?:code|desktop)|codex)-[\d.]+\.zip)"/,
      )?.[1] ?? `workhub-${client}.zip`;
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("下载内容为空，请重试");
  return { blob, filename };
}

export function savePlugin(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow the browser's download navigation to consume the URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
