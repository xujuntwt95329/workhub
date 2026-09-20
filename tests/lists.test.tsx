// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { RecordList, CompactRow } from "../src/compact";
import {
  RequirementsPanel,
  TestCasesPanel,
  TodosPanel,
} from "../src/task-lists";
import { Editor } from "../src/components";
import { HubContext, type Hub } from "../src/state";
import { owner } from "../server/service";
import { record, sha } from "./fixtures";
import type { Entity } from "../shared/domain";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function hub(records: Entity[]): Hub {
  return {
    records,
    actor: owner,
    project: "all",
    setProject: vi.fn(),
    refresh: vi.fn(),
    edit: vi.fn(),
    notify: vi.fn(),
    act: vi.fn(),
    sample: false,
  };
}
it("shows only one page of collapsed rows, supports search and page size, and expands details on demand", () => {
  const records = Array.from({ length: 61 }, (_, i) =>
    record("requirement", {
      id: "r" + i,
      key: "REQ-" + i,
      title: "Item " + i,
      body: "Details " + i,
    }),
  );
  render(
    <MemoryRouter>
      <RecordList records={records}>
        {(r) => (
          <CompactRow record={r}>
            <p>{r.body}</p>
          </CompactRow>
        )}
      </RecordList>
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("article")).toHaveLength(25);
  expect(screen.queryByText("Details 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开Item 0" }));
  expect(screen.getByText("Details 0")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("Item 25")).toBeVisible();
  expect(screen.queryByText("Item 0")).toBeNull();
  fireEvent.change(screen.getByLabelText("每页条数"), {
    target: { value: "50" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(50);
  fireEvent.change(screen.getByLabelText("搜索列表"), {
    target: { value: "REQ-60" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Item 60")).toBeVisible();
});
it("groups requirements, separates rejected items, expands criteria and preselects their test association", () => {
  const task = record("task"),
    g = record("requirement_group", { id: "g", title: "Search experience" }),
    req = record("requirement", {
      data: { groupId: g.id },
      title: "Article search",
    }),
    ac = record("criterion", {
      title: "Matching articles appear once",
      data: { requirementId: req.id },
    }),
    rejected = record("requirement", {
      id: "rejected",
      title: "Future scope",
      status: "rejected",
    });
  const ctx = hub([task, g, req, ac, rejected]);
  render(
    <MemoryRouter>
      <HubContext.Provider value={ctx}>
        <RequirementsPanel task={task} />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.queryByText(ac.title)).toBeNull();
  expect(screen.queryByText(rejected.title)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开Article search" }));
  expect(screen.getByText(ac.title)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开" + ac.title }));
  fireEvent.click(screen.getByRole("button", { name: "关联新用例" }));
  expect(ctx.edit).toHaveBeenCalledWith({
    kind: "check",
    taskId: task.id,
    criterionIds: [ac.id],
  });
  fireEvent.click(screen.getByRole("button", { name: /拒绝列表/ }));
  expect(screen.getByText(rejected.title)).toBeVisible();
  expect(screen.queryByText(req.title)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "恢复" }));
  expect(ctx.act).toHaveBeenCalled();
});
it("collapses criteria independently while preserving summary actions and the requirement body", () => {
  const task = record("task"),
    req = record("requirement", {
      title: "Search articles",
      body: "Readers can find relevant articles.",
    }),
    first = record("criterion", {
      id: "first-criterion",
      title: "Matching results",
      body: "All matching articles appear exactly once.",
      approvedVersion: null,
      data: { requirementId: req.id },
    }),
    second = record("criterion", {
      id: "second-criterion",
      title: "Empty results",
      body: "No matches displays a helpful suggestion.",
      data: { requirementId: req.id },
    }),
    ctx = hub([task, req, first, second]);
  render(
    <MemoryRouter>
      <HubContext.Provider value={ctx}>
        <RequirementsPanel task={task} />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "展开" + req.title }));
  for (const c of [first, second]) {
    expect(
      screen.getByRole("button", { name: "展开" + c.title }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(c.body)).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "关联新用例" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑" + first.title }));
  expect(ctx.edit).toHaveBeenCalledWith({ kind: "criterion", entity: first });
  fireEvent.click(screen.getByRole("button", { name: "确认" + first.title }));
  expect(ctx.act).toHaveBeenCalled();
  expect(screen.queryByText(first.body)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "展开" + first.title }));
  expect(screen.getByText(first.body)).toBeVisible();
  expect(screen.queryByText(second.body)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开" + second.title }));
  fireEvent.click(screen.getByRole("button", { name: "收起" + first.title }));
  expect(screen.queryByText(first.body)).toBeNull();
  expect(screen.getByText(second.body)).toBeVisible();
  expect(screen.getByText(req.body)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "收起" + second.title }),
  ).toHaveAttribute("aria-expanded", "true");
});
it("opens a deep-linked criterion inside its rejected requirement and navigates cases back to exact sources", async () => {
  const task = record("task", { data: { codeRef: sha } }),
    req = record("requirement", { status: "rejected", title: "Old scope" }),
    ac = record("criterion", {
      title: "Old criterion",
      body: "Previously agreed acceptance details.",
      data: { requirementId: req.id },
    }),
    testCase = record("check", {
      title: "Case",
      data: { criterionIds: [ac.id] },
    });
  const ctx = hub([task, req, ac, testCase]);
  const { unmount } = render(
    <MemoryRouter
      initialEntries={["/tasks/task?tab=requirements&focus=" + ac.id]}
    >
      <HubContext.Provider value={ctx}>
        <RequirementsPanel task={task} />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText(ac.title)).toBeVisible());
  expect(screen.getByText(ac.body)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "收起" + ac.title }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: /CHECK-001/ })).toHaveAttribute(
    "href",
    "/tasks/task?tab=tests&focus=check",
  );
  unmount();
  render(
    <MemoryRouter initialEntries={["/tasks/task?tab=tests&focus=check"]}>
      <HubContext.Provider value={ctx}>
        <TestCasesPanel task={task} />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /REQUIREMENT-001/ })).toHaveAttribute(
    "href",
    "/tasks/task?tab=requirements&focus=requirement",
  );
  expect(screen.getByRole("link", { name: /CRITERION-001/ })).toHaveAttribute(
    "href",
    "/tasks/task?tab=requirements&focus=criterion",
  );
});
it("isolates task todos and creates new ideas with their task scope", () => {
  const task = record("task"),
    local = record("todo", { title: "Local", status: "inbox" }),
    global = record("todo", {
      id: "global",
      title: "Global",
      taskId: null,
      status: "inbox",
    }),
    ctx = hub([task, local, global]);
  render(
    <MemoryRouter>
      <HubContext.Provider value={ctx}>
        <TodosPanel task={task} />
      </HubContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByText("Local")).toBeVisible();
  expect(screen.queryByText("Global")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建待办" }));
  expect(ctx.edit).toHaveBeenCalledWith({ kind: "todo", taskId: task.id });
});
it("captures requirement, criterion and case versions when creating execution evidence", async () => {
  const task = record("task", { data: { codeRef: sha } }),
    req = record("requirement", { version: 7 }),
    ac = record("criterion", { version: 3, data: { requirementId: req.id } }),
    testCase = record("check", { version: 4, data: { criterionIds: [ac.id] } });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: record("result") })),
    );
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <Editor
        spec={{ kind: "result", taskId: task.id, checkId: testCase.id }}
        records={[task, req, ac, testCase]}
        onClose={vi.fn()}
        onSaved={saved}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "Execution" },
  });
  fireEvent.change(screen.getByLabelText("验证证据"), {
    target: { value: "100 article search assertions passed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).data).toMatchObject({
    checkId: testCase.id,
    checkVersion: 4,
    criterionVersions: { [ac.id]: 3 },
    requirementVersions: { [req.id]: 7 },
    codeRef: sha,
  });
});
