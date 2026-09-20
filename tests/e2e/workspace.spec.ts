import { test, expect, type Cookie } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
let cookies: Cookie[];

test("downloads Claude plugins with installation help on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/settings?tab=plugins");
  await expect(
    page.getByRole("heading", { name: "下载你的插件" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/claude-plugin-desktop.png",
    fullPage: true,
  });
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  const codeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载插件 ZIP" }).click();
  const code = await codeDownload;
  expect(code.suggestedFilename()).toMatch(/^workhub-claude-code-/);
  const codePath = "artifacts/claude-plugin-browser-code.zip";
  await code.saveAs(codePath);
  const codeFiles = unzipSync(readFileSync(codePath));
  expect(
    JSON.parse(
      strFromU8(codeFiles["workhub-marketplace/plugins/workhub/.mcp.json"]),
    ).mcpServers.workhub.url,
  ).toBe("http://127.0.0.1:3101/mcp");
  await page.getByLabel("连接认证").selectOption("token");
  await expect(page.getByText(/Read-Host/)).toBeVisible();
  await page.getByRole("link", { name: "Agent 接入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建凭证", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Claude 插件", exact: true }).click();
  await page.getByRole("button", { name: /Claude 桌面端/ }).click();
  await expect(
    page.getByRole("button", { name: "下载插件 ZIP" }),
  ).toBeDisabled();
  await page.getByLabel("WorkHub 访问地址").fill("https://hub.example");
  const desktopDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载插件 ZIP" }).click();
  const desktop = await desktopDownload;
  expect(desktop.suggestedFilename()).toMatch(/^workhub-claude-desktop-/);
  const desktopPath = "artifacts/claude-plugin-browser-desktop.zip";
  await desktop.saveAs(desktopPath);
  const desktopFiles = unzipSync(readFileSync(desktopPath));
  expect(desktopFiles[".claude-plugin/plugin.json"]).toBeDefined();
  expect(
    JSON.parse(strFromU8(desktopFiles[".mcp.json"])).mcpServers.workhub.url,
  ).toBe("https://hub.example/mcp");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Claude Code/ }).click();
  await page.screenshot({
    path: "artifacts/claude-plugin-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "下载插件 ZIP" }),
  ).toBeVisible();
});
test.beforeAll(async ({ request }) => {
  const initialized = (await (await request.get("/api/auth/status")).json())
    .initialized;
  const res = await request.post(
    initialized ? "/api/auth/login" : "/api/auth/setup",
    { data: { name: "Alex", password: "local-test-2026!", sample: true } },
  );
  expect(res.ok(), await res.text()).toBe(true);
  cookies = (await request.storageState()).cookies;
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});
test("shows login errors, signs in, and can return to the login screen", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:3101");
    await expect(
      page.getByRole("heading", { name: "欢迎回到你的工作空间" }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/login-desktop.png",
      fullPage: true,
    });
    await page.getByLabel("你的名字").fill("Alex");
    await page.getByLabel("密码", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: "进入工作空间" }).click();
    await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");
    await page.getByLabel("密码", { exact: true }).fill("local-test-2026!");
    await page.getByRole("button", { name: "进入工作空间" }).click();
    await expect(page.locator(".hero")).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "欢迎回到你的工作空间" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("dashboard loads real metrics without browser errors and passes accessibility checks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".hero")).toBeVisible();
  await expect(
    page.getByText("文章搜索与筛选", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});
test("captures an idea, edits its contents and converts it to a task", async ({
  page,
}) => {
  await page.goto("/todos");
  await page.getByLabel("随手记下想法").fill("支持性能基线对比");
  await page.getByRole("button", { name: "记下来", exact: true }).click();
  const note = page
    .locator(".compact-record")
    .filter({ hasText: "支持性能基线对比" });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: /编辑/ }).click();
  await page
    .getByLabel("说明", { exact: true })
    .fill("比较每次修改前后的 P95 延迟。");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await note.getByRole("button", { name: "展开支持性能基线对比" }).click();
  await expect(note).toContainText("P95");
  await note.getByRole("button", { name: /转为新任务/ }).click();
  await expect(
    page.getByText("已转为新任务", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "已转任务", exact: true }).click();
  await expect(
    page.getByText("支持性能基线对比", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/ideas-desktop.png",
    fullPage: true,
  });
});
test("creates a task, writes and reviews a requirement, adds acceptance criteria and records design history", async ({
  page,
}) => {
  await page.goto("/tasks");
  await page
    .getByRole("button", { name: "创建任务", exact: true })
    .first()
    .click();
  await page.getByLabel("标题", { exact: true }).fill("修复分类切换后的分页");
  await page
    .getByLabel("说明", { exact: true })
    .fill("切换分类时重置到第一页。");
  await page
    .getByRole("button", { name: /保存|创建/ })
    .last()
    .click();
  await page.getByText("修复分类切换后的分页", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "修复分类切换后的分页" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始任务" }).click();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: /需求/ })
    .click();
  await page
    .getByRole("button", { name: /添加需求|新建需求/ })
    .first()
    .click();
  await page
    .getByLabel("标题", { exact: true })
    .fill("切换分类后展示第一页结果");
  await page
    .getByLabel("说明", { exact: true })
    .fill("分类变化后不能沿用旧页码。");
  await page
    .getByRole("button", { name: /保存|创建/ })
    .last()
    .click();
  await expect(
    page.getByText("切换分类后展示第一页结果", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "展开切换分类后展示第一页结果" })
    .click();
  await page.getByRole("button", { name: /添加验收标准/ }).click();
  await page.getByLabel("标题", { exact: true }).fill("切换到新分类时页码为 1");
  await page
    .getByRole("button", { name: /保存|创建/ })
    .last()
    .click();
  await expect(
    page.getByText("切换到新分类时页码为 1", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: /设计/ })
    .click();
  await page
    .getByRole("button", { name: /添加设计|新建设计/ })
    .first()
    .click();
  await page.getByLabel("标题", { exact: true }).fill("分页交互");
  await page
    .getByLabel("说明", { exact: true })
    .fill("## 方案\n先更新分类，然后重置页码并加载结果。");
  await page
    .getByRole("button", { name: /保存|创建/ })
    .last()
    .click();
  await expect(page.getByText("分页交互", { exact: true })).toBeVisible();
});
test("shows quality evidence and blocked acceptance, and exports a matrix", async ({
  page,
}) => {
  await page.goto("/tasks");
  await page.getByText("文章搜索与筛选", { exact: true }).click();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("阻塞");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: "质量", exact: true })
    .click();
  await expect(page.locator(".matrix-table")).toBeVisible();
  await page.screenshot({
    path: "artifacts/quality-desktop.png",
    fullPage: true,
  });
  await page.goto("/reports");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /CSV/ }).click();
  expect((await download).suggestedFilename()).toBe("workhub-matrix.csv");
  await page.getByRole("button", { name: /保存.*快照/ }).click();
  await expect(
    page.getByText("报告快照已保存", { exact: false }),
  ).toBeVisible();
});
test("supports model configuration guidance and a revocable scoped Agent credential", async ({
  page,
}) => {
  await page.goto("/assistant");
  await expect(page.getByText("一起把复杂的事，聊清楚。")).toBeVisible();
  await expect(
    page.getByText("配置 LLM API Key 后，即可启用智能问答。"),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Agent 接入", exact: true }).click();
  await page.getByRole("button", { name: "创建凭证", exact: true }).click();
  await page.getByLabel("Agent 名称").fill("浏览器测试 Agent");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建凭证", exact: true })
    .click();
  await expect(page.locator(".token-secret")).not.toBeEmpty();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "撤销浏览器测试 Agent" }).click();
  await expect(
    page.locator(".token-row").filter({ hasText: "浏览器测试 Agent" }),
  ).toContainText("已撤销");
});
test("mobile navigation and capture remain usable without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".hero")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.locator(".sidebar").getByRole("link", { name: /待办/ }).click();
  await page.getByLabel("随手记下想法").fill("移动端的灵感");
  await page.getByRole("button", { name: "记下来", exact: true }).click();
  await expect(page.getByText("移动端的灵感", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("records versioned evidence, checks a required principle, and completes a task with an acceptance snapshot", async ({
  page,
}) => {
  const create = async (input: object) => {
    const res = await page.request.post("/api/v1/records", { data: input });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).data;
  };
  const project = await create({ kind: "project", title: "验收流程验证" });
  const task = await create({
    kind: "task",
    title: "验证完整验收流程",
    projectId: project.id,
    data: { codeRef: "a".repeat(40) },
  });
  await create({
    kind: "principle",
    taskId: task.id,
    title: "搜索结果必须完整且可解释",
    body: "所有匹配文章必须可查，筛选条件应清晰可见。",
    projectId: project.id,
    data: { scope: "task", strength: "required" },
    approve: true,
  });
  await page.request.post("/api/v1/tasks/" + task.id + "/principle-adoptions", {
    data: { expectedVersion: 1 },
  });
  const req = await create({
    kind: "requirement",
    title: "完整搜索结果",
    taskId: task.id,
    approve: true,
  });
  const ac = await create({
    kind: "criterion",
    title: "100 篇匹配文章均可查",
    taskId: task.id,
    data: { requirementId: req.id },
    approve: true,
  });
  await create({
    kind: "check",
    title: "文章搜索集成检查",
    taskId: task.id,
    data: { criterionIds: [ac.id] },
    approve: true,
  });
  await page.goto("/tasks/" + task.id);
  await page.getByRole("button", { name: "开始任务" }).click();
  await expect(
    page.getByText("必需原则尚未完成当前代码版本的人工核对"),
  ).toBeVisible();
  await page.getByRole("button", { name: "核对", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("所有匹配文章必须可查");
  await page
    .getByLabel("核对依据")
    .fill("检查搜索接口和分页测试：所有匹配文章均能在结果中找到。");
  await page.getByRole("button", { name: "确认符合原则" }).click();
  await expect(
    page.getByRole("button", { name: "已核对", exact: true }),
  ).toBeVisible();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: "质量", exact: true })
    .click();
  await page.getByRole("button", { name: "记录验证", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("100 篇文章搜索测试");
  await page
    .getByLabel("验证证据")
    .fill("npm test -- article-search：100 条断言全部通过。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".matrix-table")).toContainText("通过");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("目标 commit SHA").fill("b".repeat(40));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".matrix-table")).toContainText("待复验");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("目标 commit SHA").fill("a".repeat(40));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已满足所有验收条件");
  await page.getByRole("button", { name: "确认验收", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新打开", exact: true }),
  ).toBeVisible();
  const reports = await (
    await page.request.get("/api/v1/tasks/" + task.id + "/reports")
  ).json();
  expect(reports.data).toHaveLength(1);
  expect(reports.data[0].kind).toBe("acceptance");
});

test("groups requirements, traces a case and run in both directions, and preserves rejected/deleted records", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const create = async (input: object) => {
    const res = await page.request.post("/api/v1/records", { data: input });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).data;
  };
  const project = await create({ kind: "project", title: "追溯流程" }),
    task = await create({
      kind: "task",
      title: "文章搜索追溯验证",
      projectId: project.id,
      data: { codeRef: "a".repeat(40) },
    });
  await page.goto("/tasks/" + task.id + "?tab=requirements");
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("搜索与筛选");
  await page.getByRole("button", { name: /^保存/ }).click();
  await page.getByRole("button", { name: "添加需求", exact: true }).click();
  await page
    .getByLabel("标题", { exact: true })
    .fill("匹配文章均出现在搜索结果中");
  await page
    .getByLabel("说明", { exact: true })
    .fill("不得遗漏或重复展示匹配文章");
  await page
    .getByRole("combobox", { name: "需求分组", exact: true })
    .selectOption({ label: "搜索与筛选" });
  await page.getByRole("button", { name: /^保存/ }).click();
  const requirement = page
    .locator(".compact-record")
    .filter({ hasText: "匹配文章均出现在搜索结果中" });
  await expect(requirement.locator(".compact-detail")).toHaveCount(0);
  await requirement
    .getByRole("button", { name: "展开匹配文章均出现在搜索结果中" })
    .click();
  await page.getByRole("button", { name: "添加验收标准", exact: true }).click();
  await page
    .getByLabel("标题", { exact: true })
    .fill("100 篇匹配文章各出现一次");
  await page.getByRole("button", { name: /^保存/ }).click();
  await page
    .getByRole("button", { name: "展开100 篇匹配文章各出现一次" })
    .click();
  await page.getByRole("button", { name: "关联新用例", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("搜索回归用例");
  await page
    .getByLabel("执行步骤", { exact: true })
    .fill("导入 100 篇示例文章，搜索共同关键词");
  await page
    .getByLabel("预期结果", { exact: true })
    .fill("结果总数为 100，没有重复文章");
  await expect(
    page.getByRole("checkbox", { name: /100 篇匹配文章各出现一次/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: /^保存/ }).click();
  await requirement.getByRole("link", { name: /搜索回归用例/ }).click();
  await expect(page).toHaveURL(/tab=tests&focus=/);
  await expect(
    page.getByText("导入 100 篇示例文章，搜索共同关键词"),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/test-case-traceability.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "记录执行", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("搜索回归执行 1");
  await page
    .getByLabel("验证证据")
    .fill("查询 100 篇匹配文章，零遗漏、零重复。");
  await page.getByRole("button", { name: /^保存/ }).click();
  await page.getByRole("link", { name: /搜索回归执行 1/ }).click();
  await expect(page).toHaveURL(/tab=quality&focus=/);
  await expect(page.locator(".compact-detail")).toContainText(
    "本次执行绑定的版本",
  );
  const run = page
    .locator(".compact-record")
    .filter({ hasText: "搜索回归执行 1" });
  await run.getByRole("link", { name: /匹配文章均出现在搜索结果中/ }).click();
  await expect(page).toHaveURL(/tab=requirements&focus=/);
  await requirement
    .getByRole("button", {
      name: "拒绝匹配文章均出现在搜索结果中",
      exact: true,
    })
    .click();
  await page.getByLabel("原因", { exact: true }).fill("下一阶段再做");
  await page.getByRole("button", { name: "移入拒绝列表", exact: true }).click();
  await page.getByRole("button", { name: /^拒绝列表/ }).click();
  await expect(requirement).toBeVisible();
  await expect(requirement).toContainText("下一阶段再做");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: /当前需求/ }).click();
  await expect(requirement).toContainText("待确认");
  await requirement
    .getByRole("button", {
      name: "删除匹配文章均出现在搜索结果中",
      exact: true,
    })
    .click();
  await page.getByLabel("原因", { exact: true }).fill("重新评估范围");
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await page.getByRole("button", { name: /^回收站/ }).click();
  await expect(requirement).toBeVisible();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: /当前需求/ }).click();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: "质量", exact: true })
    .click();
  await expect(page.locator(".matrix-table")).toContainText("待复验");
  const graph = (
    await (
      await page.request.get("/api/v1/tasks/" + task.id + "/traceability")
    ).json()
  ).data;
  expect(graph.cases[0].runCount).toBe(1);
  expect(graph.cases[0].state).toBe("stale");
  expect(errors).toEqual([]);
});

test("separates acceptance criteria visually and supports keyboard collapse, trace links and mobile layouts", async ({
  page,
}) => {
  const create = async (input: object) => {
    const response = await page.request.post("/api/v1/records", {
      data: input,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const project = await create({ kind: "project", title: "示例知识库" }),
    task = await create({
      kind: "task",
      title: "文章搜索与分类筛选",
      projectId: project.id,
    }),
    requirement = await create({
      kind: "requirement",
      title: "读者可以通过关键词与分类找到相关文章",
      taskId: task.id,
      body: "支持按关键词搜索文章，并按分类缩小结果范围。\n\n搜索应保留当前筛选条件，明确展示结果总数，并在没有匹配文章时提供清晰的提示。",
      approve: true,
    }),
    first = await create({
      kind: "criterion",
      title: "匹配文章完整展示，且没有重复结果",
      taskId: task.id,
      body: "1. 准备 100 篇包含共同关键词的文章。\n2. 输入关键词，结果总数应为 **100**。\n3. 翻页检查，每篇文章只出现一次。\n\n判定依据：搜索结果与预期文章集合一致。",
      data: { requirementId: requirement.id },
      approve: true,
    }),
    second = await create({
      kind: "criterion",
      title: "切换分类后从第一页展示结果",
      taskId: task.id,
      body: "在第二页切换分类后，页码重置为 1，并展示新分类的匹配文章。",
      data: { requirementId: requirement.id },
    });
  await create({
    kind: "check",
    title: "文章搜索完整性检查",
    taskId: task.id,
    data: { criterionIds: [first.id] },
  });
  const url = "/tasks/" + task.id + "?tab=requirements";
  await page.goto(url);
  await page.getByRole("button", { name: "展开" + requirement.title }).click();
  const firstRow = page.locator("#record-" + first.id),
    secondRow = page.locator("#record-" + second.id);
  await expect(firstRow.locator(".compact-detail")).toHaveCount(0);
  await expect(secondRow.locator(".compact-detail")).toHaveCount(0);
  expect((await secondRow.boundingBox())?.height).toBeLessThanOrEqual(44);

  const toggle = firstRow.getByRole("button", { name: "展开" + first.title });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(
    firstRow.getByText("准备 100 篇包含共同关键词的文章。"),
  ).toBeVisible();
  await expect(
    firstRow.getByRole("link", { name: /文章搜索完整性检查/ }),
  ).toBeVisible();
  await expect(secondRow.locator(".compact-detail")).toHaveCount(0);
  await firstRow
    .getByRole("button", { name: "收起" + first.title })
    .press("Space");
  await expect(firstRow.locator(".compact-detail")).toHaveCount(0);

  // A traceability deep link must open both the requirement and its criterion.
  await page.goto(url + "&focus=" + first.id);
  await expect(
    firstRow.getByRole("button", { name: "收起" + first.title }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    firstRow.getByText("准备 100 篇包含共同关键词的文章。"),
  ).toBeVisible();
  await expect(
    secondRow.getByRole("button", { name: "展开" + second.title }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: "artifacts/acceptance-criteria-desktop.png",
    fullPage: true,
  });
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator(".sidebar").evaluate((e) => e.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await firstRow.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/acceptance-criteria-mobile.png",
    fullPage: true,
  });
  await firstRow.getByRole("button", { name: "收起" + first.title }).click();
  await expect(firstRow.locator(".compact-detail")).toHaveCount(0);
  await secondRow.getByRole("button", { name: "展开" + second.title }).click();
  await expect(secondRow.getByText(second.body)).toBeVisible();
});

test("keeps large requirement lists dense, paginated, searchable and accessible on desktop and mobile", async ({
  page,
}) => {
  const create = async (input: object) => {
    const res = await page.request.post("/api/v1/records", { data: input });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).data;
  };
  const project = await create({ kind: "project", title: "列表容量" }),
    task = await create({
      kind: "task",
      title: "示例知识库 · 搜索与阅读体验",
      projectId: project.id,
    });
  const groups = [];
  for (const title of ["文章搜索", "分类管理", "阅读体验"])
    groups.push(
      await create({ kind: "requirement_group", title, taskId: task.id }),
    );
  for (let i = 0; i < 36; i++)
    await create({
      kind: "requirement",
      title:
        String(i + 1).padStart(2, "0") +
        " · " +
        [
          "搜索结果每页数量可以通过设置调整",
          "匹配文章按更新时间稳定排序",
          "切换分类后自动回到第一页",
          "无匹配文章时提供搜索建议",
          "当前筛选条件与结果总数清晰可见",
          "清空筛选条件后恢复默认文章列表",
        ][i % 6],
      body: "展开后查看完整说明、验收标准和关联测试证据。",
      taskId: task.id,
      data: {
        groupId: groups[Math.floor(i / 12)].id,
        priority: i % 4 ? "should" : "must",
      },
      approve: i % 3 !== 0,
    });
  await page.goto("/tasks/" + task.id + "?tab=requirements");
  await expect(page.locator(".compact-record")).toHaveCount(25);
  await expect(page.locator(".compact-detail")).toHaveCount(0);
  const row = await page.locator(".compact-row").first().boundingBox();
  expect(row?.height).toBeLessThanOrEqual(50);
  await page.screenshot({
    path: "artifacts/requirements-compact-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".compact-record")).toHaveCount(11);
  await page.getByLabel("搜索列表", { exact: true }).fill("36 ·");
  await expect(page.locator(".compact-record")).toHaveCount(1);
  await page.getByLabel("搜索列表", { exact: true }).fill("");
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  await expect(page.locator(".compact-detail")).toHaveCount(25);
  await page.getByRole("button", { name: "全部收起", exact: true }).click();
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator(".sidebar").evaluate((e) => e.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/requirements-compact-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("creates task-owned ideas and principles, and assigns a global idea into its task", async ({
  page,
}) => {
  const create = async (input: object) => {
    const res = await page.request.post("/api/v1/records", { data: input });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).data;
  };
  const project = await create({ kind: "project", title: "任务内容归属" }),
    task = await create({
      kind: "task",
      title: "只属于我的任务",
      projectId: project.id,
    });
  await page.goto("/tasks/" + task.id + "?tab=todos");
  await page.getByLabel("随手记下想法").fill("考虑保存常用筛选条件");
  await page.getByRole("button", { name: "记下来", exact: true }).click();
  await expect(
    page.getByText("考虑保存常用筛选条件", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".task-tabs")
    .getByRole("button", { name: /基本原则/ })
    .click();
  await page.getByRole("button", { name: "新增原则", exact: true }).click();
  await page
    .getByLabel("标题", { exact: true })
    .fill("用户输入必须校验并给出反馈");
  await expect(page.getByLabel("适用范围", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^保存/ }).click();
  await expect(
    page.getByText("用户输入必须校验并给出反馈", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".sidebar").getByRole("link", { name: /基本原则/ }),
  ).toHaveCount(0);
  await page.goto("/todos");
  await page.getByLabel("随手记下想法").fill("先记下一个全局想法");
  await page.getByRole("button", { name: "记下来", exact: true }).click();
  const todo = page
    .locator(".compact-record")
    .filter({ hasText: "先记下一个全局想法" });
  await todo.getByRole("button", { name: "归属任务", exact: true }).click();
  await page.getByRole("combobox", { name: "选择任务" }).selectOption(task.id);
  await page.getByRole("button", { name: "保存归属", exact: true }).click();
  await expect(todo).toContainText("只属于我的任务");
  await page.goto("/tasks/" + task.id + "?tab=todos");
  await expect(page.locator(".compact-record")).toHaveCount(2);
  const context = (
    await (
      await page.request.get("/api/v1/tasks/" + task.id + "/context")
    ).json()
  ).data;
  expect(context.records.filter((r: any) => r.kind === "todo")).toHaveLength(2);
  expect(context.records.find((r: any) => r.kind === "principle").taskId).toBe(
    task.id,
  );
});
