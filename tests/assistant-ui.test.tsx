// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { AssistantSummary } from "../src/assistant-summary";
import { AssistantPage } from "../src/tools-pages";
import { HubContext, type Hub } from "../src/state";
import { owner } from "../server/service";
import { record } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

it("shows queued/running summaries, polls completed output, and preserves it when regeneration fails", async () => {
  let state: any = { configured: true, data: null, latestRun: null };
  let poll!: () => Promise<void>;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    fn: () => Promise<void>,
    delay: number,
  ) => {
    if (delay === 5000) {
      poll = fn;
      return 999999;
    }
    return interval(fn, delay);
  }) as any);
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (options?.method === "POST") {
      state = { ...state, latestRun: { id: "run", status: "queued" } };
      return response(state.latestRun);
    }
    return response(state);
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <MemoryRouter>
      <AssistantSummary taskId="task" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "生成概览" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("已排队"),
  );
  expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
  state.latestRun.status = "running";
  await act(async () => {
    await poll();
  });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("正在生成"),
  );
  state = {
    configured: true,
    latestRun: { id: "run", status: "succeeded" },
    data: {
      answer: "已经生成的摘要",
      stale: false,
      finished_at: "2026-09-20T00:00:00Z",
    },
  };
  await act(async () => {
    await poll();
  });
  expect(await screen.findByText("已经生成的摘要")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("已排队"),
  );
  state.latestRun = {
    id: "retry",
    status: "failed",
    error: "模型服务返回 503",
  };
  await act(async () => {
    await poll();
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("模型服务返回 503"),
  );
  expect(screen.getByText("已经生成的摘要")).toBeVisible();
  expect(screen.getByRole("button", { name: "重新生成" })).toBeEnabled();
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(2);
});

it("distinguishes missing model configuration from a failed summary read and allows retry", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ error: { message: "暂时断线" } }, 503))
    .mockResolvedValue(
      response({ configured: false, data: null, latestRun: null }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(
    <MemoryRouter>
      <AssistantSummary taskId="task" />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时断线");
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(await screen.findByRole("link", { name: "配置模型" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(screen.queryByRole("button", { name: "生成概览" })).toBeNull();
});

it("sends the selected task with a question instead of silently falling back to workspace scope", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const task = record("task", { title: "文章搜索" });
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
    response(
      options?.method === "POST"
        ? { id: "run", status: "queued" }
        : { configured: true },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const hub: Hub = {
    records: [task],
    actor: owner,
    project: "all",
    setProject: vi.fn(),
    refresh: vi.fn(),
    edit: vi.fn(),
    notify: vi.fn(),
    act: vi.fn(),
    sample: false,
  };
  render(
    <MemoryRouter>
      <HubContext.Provider value={hub}>
        <AssistantPage />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("助手范围"), {
    target: { value: task.id },
  });
  fireEvent.change(screen.getByLabelText("向助手提问"), {
    target: { value: "请总结质量缺口" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(true),
  );
  const sent = fetcher.mock.calls.find(
    ([, options]) => options?.method === "POST",
  )!;
  expect(JSON.parse(String(sent[1]?.body))).toMatchObject({
    taskId: task.id,
    question: "请总结质量缺口",
  });
});
