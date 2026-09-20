import type { Entity } from "../shared/domain.js";
import type { Service } from "./service.js";

type Context = Awaited<ReturnType<Service["context"]>>;
export const contextLimit = 60000;

// The API context embeds full records repeatedly in matrices and traceability.
// LLM input uses one record per version and compact, deterministic quality facts.
export function assistantContext(context: Context, question: string) {
  const terms = [
    ...new Set([
      ...(question.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []),
      ...Array.from(
        question.matchAll(/(?=([\p{Script=Han}]{2}))/gu),
        (m) => m[1],
      ),
    ]),
  ].slice(0, 80);
  const candidates = [
    ...new Map(
      [
        ...(context.task ? [context.task] : []),
        ...context.records,
        ...(context.principles ?? []),
        ...(context.availablePrincipleUpdates ?? []),
        ...(context.excludedRequirements ?? []),
      ].map((r) => [r.id + ":" + r.version, r]),
    ).values(),
  ];
  const counts: Record<string, number> = {};
  const active = new Map(
    [...context.records, ...(context.task ? [context.task] : [])].map((r) => [
      r.id,
      r,
    ]),
  );
  for (const r of active.values()) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const score = (r: Entity) => {
    const title = r.title.toLowerCase(),
      body = r.body.toLowerCase();
    return (
      (question.toLowerCase().includes(r.key.toLowerCase()) ||
      question.includes(r.id)
        ? 1000
        : 0) +
      (r.kind === "task" ? (context.scope === "task" ? 100 : 2) : 0) +
      (r.starred ? 4 : 0) +
      (["blocked", "open"].includes(r.status) ? 3 : 0) +
      terms.reduce(
        (n, term) =>
          n + (title.includes(term) ? 10 : 0) + (body.includes(term) ? 1 : 0),
        0,
      )
    );
  };
  const ranked = candidates
    .map((r) => ({ r, score: score(r) }))
    .sort((a, b) => b.score - a.score || b.r.sequence - a.r.sequence);
  const report = context.report;
  const states: Record<string, number> = {};
  for (const row of report?.rows ?? [])
    states[row.state] = (states[row.state] ?? 0) + 1;
  const data = {
    scope: context.scope,
    taskId: context.task?.id,
    counts,
    excludedRequirementCount: context.excludedRequirements?.length ?? 0,
    report: report
      ? {
          metrics: report.metrics,
          gapCount: report.gaps.length,
          gaps: report.gaps.slice(0, 20).map((g) => g.slice(0, 300)),
          matrixStates: states,
          traceabilityGapCounts: Object.fromEntries(
            Object.entries(report.traceability.gaps).map(([key, items]) => [
              key,
              items.length,
            ]),
          ),
          // Relations are also present in the selected records' data fields.
          matrixSample: report.rows.slice(0, 20).map((row) => ({
            requirementId: row.requirement?.id,
            criterionId: row.criterion.id,
            state: row.state,
            checkIds: row.checks.slice(0, 8).map((c) => c.check.id),
            checkCount: row.checks.length,
          })),
          matrixRowCount: report.rows.length,
        }
      : undefined,
    records: [] as Record<string, unknown>[],
    coverage: {
      totalRecords: candidates.length,
      includedRecords: 0,
      omittedRecords: 0,
      shortenedRecords: 0,
      selection:
        "优先提供任务目标、问题相关内容、关注项和阻塞；正文及关联列表可能节选。统计基于完整授权范围，详情仅限提供的记录；不要把未提供的内容解释为不存在。",
    },
  };
  const sourceRecords: Entity[] = [];
  let size = JSON.stringify(data).length;
  for (const { r } of ranked) {
    let shortened = false;
    function excerpt(text: string, limit: number) {
      if (text.length <= limit) return text;
      shortened = true;
      const lower = text.toLowerCase();
      const at = terms.map((t) => lower.indexOf(t)).find((i) => i >= 0) ?? 0;
      const start = Math.max(0, at - 160);
      return (
        (start ? "[前文省略] " : "") +
        text.slice(start, start + limit) +
        " [后文省略]"
      );
    }
    function compact(value: unknown, depth = 0): unknown {
      if (typeof value === "string") return excerpt(value, 700);
      if (!value || typeof value !== "object") return value;
      const entries = Object.entries(value);
      if (entries.length > 12 || depth >= 3) shortened = true;
      if (depth >= 3) return "[详情省略]";
      if (Array.isArray(value))
        return value.slice(0, 12).map((v) => compact(v, depth + 1));
      return Object.fromEntries(
        entries.slice(0, 12).map(([k, v]) => [k, compact(v, depth + 1)]),
      );
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(r.data)) {
      const next = compact(value);
      if (JSON.stringify({ ...fields, [key]: next }).length <= 6000)
        fields[key] = next;
      else shortened = true;
    }
    const item = {
      id: r.id,
      key: r.key,
      kind: r.kind,
      taskId: r.taskId,
      title: excerpt(r.title, 200),
      body: excerpt(r.body, 1800),
      status: r.status,
      version: r.version,
      approvedVersion: r.approvedVersion,
      adoptedPrincipleVersion:
        context.principles?.some(
          (p) => p.id === r.id && p.version === r.version,
        ) ?? false,
      starred: r.starred,
      data: fields,
      detailsShortened: shortened,
    };
    const length = JSON.stringify(item).length + 1;
    if (size + length > contextLimit - 1000) continue;
    data.records.push(item);
    sourceRecords.push(r);
    size += length;
    if (shortened) data.coverage.shortenedRecords++;
  }
  data.coverage.includedRecords = sourceRecords.length;
  data.coverage.omittedRecords = candidates.length - sourceRecords.length;
  return { data, sourceRecords };
}
