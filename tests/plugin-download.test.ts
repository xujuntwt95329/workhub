import { it, expect, vi, afterEach } from "vitest";
import { fetchPlugin, savePlugin } from "../src/lib/plugin-download";
const input = {
  target: "code",
  authentication: "oauth",
  baseUrl: "https://hub.example",
} as const;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("cleans up the download element and object URL even if navigation fails", () => {
  vi.useFakeTimers();
  const revokeObjectURL = vi.fn(),
    appendChild = vi.fn();
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:download"),
    revokeObjectURL,
  });
  vi.stubGlobal("document", {
    createElement: vi.fn(() => link),
    body: { appendChild },
  });
  const blob = new Blob(["ZIP"]);
  savePlugin(blob, "workhub-claude.zip");
  expect(link).toMatchObject({
    href: "blob:download",
    download: "workhub-claude.zip",
  });
  expect(appendChild).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledOnce();
  expect(link.remove).toHaveBeenCalledOnce();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  link.click.mockImplementation(() => {
    throw new Error("navigation failed");
  });
  expect(() => savePlugin(blob, "workhub-claude.zip")).toThrow(
    "navigation failed",
  );
  expect(link.remove).toHaveBeenCalledTimes(2);
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("downloads a ZIP with session authentication and uses only trusted filenames", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response("PK-test", {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="workhub-claude-code-0.1.0.zip"',
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await fetchPlugin(input);
  expect(result.filename).toBe("workhub-claude-code-0.1.0.zip");
  expect(result.blob.size).toBe(7);
  expect(fetcher.mock.calls[0]).toEqual([
    "/api/plugins/claude/download",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  ]);
  fetcher.mockResolvedValue(
    new Response("PK", {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="../../secret.html"',
      },
    }),
  );
  expect((await fetchPlugin(input)).filename).toBe("workhub-claude.zip");
  fetcher.mockResolvedValue(
    new Response("PK", { headers: { "Content-Type": "application/zip" } }),
  );
  expect((await fetchPlugin(input)).filename).toBe("workhub-claude.zip");
});
it("preserves API errors and handles a non-JSON proxy failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHENTICATED", message: "请先登录" },
          }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 502 })),
  );
  await expect(fetchPlugin(input)).rejects.toMatchObject({
    message: "请先登录",
    code: "UNAUTHENTICATED",
    status: 401,
  });
  await expect(fetchPlugin(input)).rejects.toMatchObject({
    message: "插件下载失败，请稍后重试",
    code: "DOWNLOAD_ERROR",
    status: 502,
  });
});
it("does not save a login page, unknown media type or empty successful response as a plugin", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>Login</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(new Response("no content type"))
      .mockResolvedValueOnce(
        new Response("", { headers: { "Content-Type": "application/zip" } }),
      ),
  );
  await expect(fetchPlugin(input)).rejects.toThrow("服务器未返回插件 ZIP");
  await expect(fetchPlugin(input)).rejects.toThrow("服务器未返回插件 ZIP");
  await expect(fetchPlugin(input)).rejects.toThrow("下载内容为空");
});

it("uses the Codex download API and accepts only safe archive filenames", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("PK", {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition":
            'attachment; filename="workhub-codex-0.1.0.zip"',
        },
      }),
    )
    .mockResolvedValueOnce(
      new Response("PK", {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="../../config.toml"',
        },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchPlugin({ ...input, target: "codex" })).filename).toBe(
    "workhub-codex-0.1.0.zip",
  );
  expect(fetcher).toHaveBeenCalledWith(
    "/api/plugins/codex/download",
    expect.objectContaining({ credentials: "same-origin" }),
  );
  expect((await fetchPlugin({ ...input, target: "codex" })).filename).toBe(
    "workhub-codex.zip",
  );
});
