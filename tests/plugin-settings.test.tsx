// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { PluginSettings } from "../src/plugin-settings";
import { pluginSkills } from "../shared/claude-plugin";
import { fetchPlugin, savePlugin } from "../src/lib/plugin-download";
vi.mock("../src/lib/plugin-download", () => ({
  fetchPlugin: vi.fn(),
  savePlugin: vi.fn(),
}));
const metadata = {
  name: "workhub",
  version: "0.1.0",
  publicUrl: "http://127.0.0.1:5173",
  skills: pluginSkills,
};
const setup = () => {
  const notify = vi.fn();
  render(
    <MemoryRouter>
      <PluginSettings notify={notify} />
    </MemoryRouter>,
  );
  return notify;
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("builds the chosen package, prevents duplicate downloads and preserves input after a failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata))),
  );
  const notify = setup();
  await screen.findByRole("heading", { name: "下载你的插件" });
  expect(screen.getByText("测试与追溯")).toBeVisible();
  fireEvent.change(screen.getByLabelText("连接认证"), {
    target: { value: "token" },
  });
  expect(screen.getByText(/Read-Host/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("终端"), {
    target: { value: "bash" },
  });
  expect(screen.getByText(/read -rsp/)).toBeVisible();
  let reject!: (error: Error) => void;
  vi.mocked(fetchPlugin).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "下载插件 ZIP" }));
  expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
  expect(fetchPlugin).toHaveBeenCalledWith({
    target: "code",
    authentication: "token",
    baseUrl: metadata.publicUrl,
  });
  reject(new Error("服务暂时不可用"));
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith("服务暂时不可用", true),
  );
  expect(screen.getByLabelText("连接认证")).toHaveValue("token");
  expect(savePlugin).not.toHaveBeenCalled();
  const artifact = {
    blob: new Blob(["ZIP"]),
    filename: "workhub-claude-code-0.1.0.zip",
  };
  vi.mocked(fetchPlugin).mockResolvedValueOnce(artifact);
  fireEvent.click(screen.getByRole("button", { name: "下载插件 ZIP" }));
  await waitFor(() =>
    expect(savePlugin).toHaveBeenCalledWith(artifact.blob, artifact.filename),
  );
  expect(notify).toHaveBeenCalledWith("插件已生成，请按下方说明安装");
});

it("requires a reachable HTTPS origin for desktop and resets token mode to OAuth", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata))),
  );
  setup();
  await screen.findByLabelText("连接认证");
  fireEvent.change(screen.getByLabelText("连接认证"), {
    target: { value: "token" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Claude 桌面端/ }));
  expect(screen.getByLabelText("连接认证")).toHaveValue("oauth");
  expect(screen.getByLabelText("连接认证")).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("HTTPS");
  expect(screen.getByRole("button", { name: "下载插件 ZIP" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("WorkHub 访问地址"), {
    target: { value: "https://my-hub.example" },
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载插件 ZIP" })).toBeEnabled();
  expect(screen.getByText(/ZIP 无需解压/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("WorkHub 访问地址"), {
    target: { value: "https://my-hub.example/?token=secret" },
  });
  expect(screen.getByRole("button", { name: "下载插件 ZIP" })).toBeDisabled();
});

it("retries metadata loading and reports clipboard failures without losing the instructions", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "请先登录" } }), {
        status: 401,
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(metadata)));
  vi.stubGlobal("fetch", fetcher);
  const notify = setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("请先登录");
  fireEvent.click(screen.getByRole("button", { name: "重新加载插件信息" }));
  const copy = await screen.findByRole("button", { name: "复制安装命令" });
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  fireEvent.click(copy);
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(
      "无法访问剪贴板，请手动选择并复制命令",
      true,
    ),
  );
  fireEvent.click(copy);
  await waitFor(() => expect(notify).toHaveBeenCalledWith("安装命令已复制"));
  expect(writeText.mock.calls[0][0]).toContain("claude plugin marketplace add");
});
