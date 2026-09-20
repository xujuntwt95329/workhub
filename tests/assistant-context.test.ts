import { it, expect } from "vitest";
import { assistantContext, contextLimit } from "../server/assistant-context";
import { record } from "./fixtures";

it("keeps a large selection within budget and prioritizes explicit record references and matching excerpts", () => {
  const records = Array.from({ length: 160 }, (_, i) =>
    record("design", {
      id: "design-" + i,
      key: "DES-" + String(i).padStart(3, "0"),
      sequence: i,
      title: "搜索方案 " + i,
      body: "A".repeat(10000) + " retention policy matters " + "B".repeat(5000),
      starred: i === 10,
    }),
  );
  const context = { scope: "workspace", records, generatedAt: "now" } as const;
  const prepared = assistantContext(
    context,
    "请解释 DES-001 的 retention policy",
  );
  expect(JSON.stringify(prepared.data).length).toBeLessThanOrEqual(
    contextLimit,
  );
  expect(prepared.sourceRecords[0].id).toBe("design-1");
  expect(prepared.data.records[0].body).toContain("retention policy");
  expect(prepared.data.coverage.omittedRecords).toBeGreaterThan(0);
  expect(prepared.data.coverage.shortenedRecords).toBe(
    prepared.data.records.length,
  );
  expect(prepared.data.counts.design).toBe(160);
  expect(
    prepared.data.coverage.includedRecords +
      prepared.data.coverage.omittedRecords,
  ).toBe(160);
  const byId = assistantContext(context, "design-0");
  expect(byId.sourceRecords[0].id).toBe("design-0");
});

it("bounds structured evidence and keeps primitive values and useful task metadata", () => {
  const task = record("task", {
    title: "Task".repeat(100),
    status: "blocked",
    data: {
      codeRef: "a".repeat(40),
      groupId: null,
      required: true,
      order: 2,
      tags: Array.from({ length: 40 }, (_, i) => "tag" + i),
      principleChecks: Array.from({ length: 20 }, (_, i) => ({
        id: "principle" + i,
        version: 1,
        codeRef: "a".repeat(40),
        actorId: "owner",
        note: "long evidence ".repeat(500),
      })),
      requirementVersions: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => ["req" + i, i]),
      ),
    },
  });
  const prepared = assistantContext(
    { scope: "workspace", records: [task], generatedAt: "now" },
    "?",
  );
  const item = prepared.data.records[0];
  expect(item.detailsShortened).toBe(true);
  expect(item.title).toContain("后文省略");
  expect(item.data).toMatchObject({ required: true, order: 2, groupId: null });
  expect(JSON.stringify(item.data).length).toBeLessThanOrEqual(6000);
  expect(JSON.stringify(prepared.data).length).toBeLessThanOrEqual(
    contextLimit,
  );
  expect(
    assistantContext(
      { scope: "workspace", records: [], generatedAt: "now" },
      "",
    ).data.coverage.includedRecords,
  ).toBe(0);
});
