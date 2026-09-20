import { Service } from "./service.js";
import type { Actor } from "../shared/domain.js";
export async function seedWorkspace(s: Service, actor: Actor, sample: boolean) {
  const project = await s.create(actor, {
    kind: "project",
    title: sample ? "示例知识库" : "我的项目",
    body: sample
      ? "一个用于演示文章管理、搜索和阅读体验的知识库网站。"
      : "在这里开始你的工程工作。",
    data: { tags: sample ? ["示例网站"] : [] },
  });
  if (!sample) return;
  const task = await s.create(actor, {
    kind: "task",
    projectId: project.id,
    title: "文章搜索与筛选",
    body: "支持按关键词和分类查找文章，让读者更容易找到需要的内容，同时保持原有列表的浏览体验。\n\n本期范围：关键词搜索、分类筛选、分页导航。保存常用筛选条件留待后续。",
    data: {
      type: "feature",
      priority: "high",
      template: "standard",
      codeRef: "a".repeat(40),
      tags: ["搜索", "易用性"],
    },
  });
  await s.changeStatus(actor, task.id, task.version, "active");
  await s.create(actor, {
    kind: "principle",
    taskId: task.id,
    title: "让搜索结果清晰、可验证",
    body: "搜索条件、结果数量与分页状态应保持一致。设计应同时说明正常结果、空结果和输入无效时的表现。",
    data: {
      scope: "task",
      strength: "recommended",
      category: "架构",
      rationale: "一致的反馈能帮助读者理解并调整搜索条件。",
    },
    approve: true,
  });
  await s.create(actor, {
    kind: "principle",
    taskId: task.id,
    title: "向后兼容，是默认承诺",
    body: "对外接口和默认行为保持兼容。需要破坏性变更时，明确迁移路径和验证范围。",
    data: { scope: "task", strength: "recommended", category: "接口" },
    projectId: project.id,
    approve: true,
  });
  await s.adoptPrinciples(actor, task.id, 2);
  const r = await s.create(actor, {
    kind: "requirement",
    taskId: task.id,
    title: "按关键词和分类查找文章",
    body: "支持组合关键词和分类条件，结果按稳定顺序分页展示。未设置筛选条件时，保持原有文章列表。",
    approve: true,
  });
  const c1 = await s.create(actor, {
    kind: "criterion",
    taskId: task.id,
    title: "关键词搜索返回正确结果",
    body: "分别验证完整标题、部分关键词、前后空格和无匹配内容的搜索结果。",
    data: { requirementId: r.id },
    approve: true,
  });
  const c2 = await s.create(actor, {
    kind: "criterion",
    taskId: task.id,
    title: "切换分类后重置分页",
    body: "在后续分页切换分类时回到第一页，展示新分类中的文章，不出现错误的空结果。",
    data: { requirementId: r.id },
    approve: true,
  });
  const c3 = await s.create(actor, {
    kind: "criterion",
    taskId: task.id,
    title: "未筛选时保持原有浏览体验",
    body: "未设置关键词和分类时，现有文章列表与分页用例全部通过。",
    data: { requirementId: r.id },
    approve: true,
  });
  await s.create(actor, {
    kind: "design",
    taskId: task.id,
    title: "搜索接口与结果列表设计",
    body: "## 设计目标\n\n为示例知识库提供清晰、易用的文章搜索能力。\n\n## 核心方案\n\n- 搜索接口接收关键词、分类和页码。\n- 返回文章列表、结果总数和分页信息。\n- 结果按更新时间与文章编号稳定排序，页面保留当前筛选条件。\n\n## 取舍\n\n首版优先支持明确的关键词匹配，个性化推荐作为后续扩展。",
    data: { category: "architecture", required: true },
    approve: true,
  });
  await s.create(actor, {
    kind: "design",
    taskId: task.id,
    title: "筛选状态与分页交互",
    body: "## 需要确认\n\n切换分类或修改关键词后，应回到第一页并更新结果数量。\n\n## 待评审的变化\n\n统一管理关键词、分类和页码，避免保留旧页码造成错误的空结果。",
    data: { category: "module", required: true },
  });
  for (const [title, status] of [
    ["实现关键词搜索表单", "done"],
    ["接入文章分类接口", "done"],
    ["完善分页重置交互", "doing"],
    ["补充筛选与兼容性验证", "todo"],
  ] as const) {
    const w = await s.create(actor, {
      kind: "work_item",
      taskId: task.id,
      title,
      data: {
        assignee: title.includes("验证") ? "质量 Agent" : "开发 Agent",
        required: true,
      },
    });
    if (status !== "todo") await s.changeStatus(actor, w.id, w.version, status);
  }
  await s.create(actor, {
    kind: "issue",
    taskId: task.id,
    title: "切换分类后分页未重置",
    body: "在文章列表第三页切换到内容较少的分类后，页面仍请求第三页，导致错误显示没有结果。\n\n需要重置页码并补充分类切换的回归验证。",
    data: { severity: "high", blocking: true },
  });
  const checks = [];
  for (const [c, type] of [
    [c1, "unit"],
    [c2, "integration"],
    [c3, "compatibility"],
  ] as const) {
    checks.push(
      await s.create(actor, {
        kind: "check",
        taskId: task.id,
        title: c.title + "检查",
        data: { criterionIds: [c.id], type, required: true },
        approve: true,
      }),
    );
  }
  for (let i = 0; i < 2; i++) {
    const c = [c1, c2][i];
    await s.create(actor, {
      kind: "result",
      taskId: task.id,
      title: i === 0 ? "搜索回归通过" : "分类切换检查失败",
      data: {
        checkId: checks[i].id,
        checkVersion: checks[i].version,
        criterionVersions: { [c.id]: c.version },
        requirementVersions: { [r.id]: r.version },
        codeRef: "a".repeat(40),
        outcome: i === 0 ? "passed" : "failed",
        evidence:
          i === 0
            ? "示例记录：完整标题、部分关键词、前后空格和无匹配内容均返回预期结果。"
            : "示例记录：在第三页切换分类后出现错误的空结果，详见关联问题。",
        environment: "示例数据 · Linux x64",
      },
    });
  }
  const other = await s.create(actor, {
    kind: "task",
    projectId: project.id,
    title: "修复空白搜索词的提示",
    body: "搜索词只有空格时展示默认文章列表，并提供清晰的搜索提示。",
    data: {
      type: "bug",
      priority: "medium",
      template: "light",
      tags: ["可靠性"],
    },
  });
  await s.changeStatus(actor, other.id, 1, "active");
  await s.create(actor, {
    kind: "task",
    projectId: project.id,
    title: "完善知识库使用指南",
    body: "补充搜索示例、分类说明和常见问题。",
    data: {
      type: "chore",
      priority: "low",
      template: "light",
      tags: ["开发体验"],
    },
  });
  for (const [title, body] of [
    [
      "支持保存常用筛选条件",
      "在基础搜索稳定后，评估收藏常用关键词和分类组合的体验。",
    ],
    ["给空结果页补充搜索建议", "帮助读者尝试更短的关键词或其他分类。"],
    ["记录搜索体验改进计划", "整理阅读反馈，逐步改进结果摘要和导航。"],
  ])
    await s.create(actor, {
      kind: "todo",
      title,
      body,
      data: { type: "idea", tags: ["稍后探索"] },
    });
  await s.db.query(
    "INSERT INTO settings(key,value) VALUES('sample','true') ON CONFLICT(key) DO UPDATE SET value='true'",
  );
}
