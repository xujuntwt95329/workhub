import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import type { Database } from "./db.js";
import { Service } from "./service.js";
import { migrateTaskPrinciples } from "./migrations.js";
import { Assistant } from "./assistant.js";
import { authRoutes, actorFor, type AuthConfig } from "./auth.js";
import { mcpRoutes, oauthRoutes } from "./mcp.js";
import { seedWorkspace } from "./seed.js";
import { recordContract } from "./contract.js";
import { claudePluginRoutes } from "./claude-plugin.js";
import {
  DomainError,
  authorize,
  ensure,
  kinds,
  type Kind,
  reportCsv,
  currentWorkspaceRecords,
} from "../shared/domain.js";
export type AppConfig = AuthConfig & {
  encryptionKey: Buffer;
  allowedLlmOrigins?: string[];
  logger?: boolean;
  staticRoot?: string;
  rateLimitMax?: number;
};
export async function buildApp(db: Database, config: AppConfig) {
  await migrateTaskPrinciples(db);
  const app = Fastify({
    logger: config.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body.password",
            "req.body.apiKey",
          ],
        }
      : false,
    bodyLimit: 2 * 1024 * 1024,
  });
  const service = new Service(db),
    assistant = new Assistant(
      db,
      service,
      config.encryptionKey,
      config.allowedLlmOrigins,
    );
  await app.register(cookie);
  await app.register(rateLimit, {
    max: config.rateLimitMax ?? 600,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "WorkHub API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          session: { type: "apiKey", in: "cookie", name: "workhub_session" },
        },
      },
      security: [{ bearerAuth: [] }, { session: [] }],
    },
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    const origin = req.headers.origin;
    const allowed = [
      config.publicUrl,
      ...(!config.production
        ? [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
          ]
        : []),
    ];
    if (
      origin &&
      !allowed.includes(origin) &&
      !path.startsWith("/oauth/token") &&
      !path.startsWith("/oauth/register")
    )
      throw new DomainError("INVALID_ORIGIN", "请求来源不受信任", 403);
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    if (path.startsWith("/api/") && !path.startsWith("/api/auth/")) {
      const actor = await actorFor(db, req);
      ensure(actor, "UNAUTHENTICATED", "请先登录", 401);
      req.actor = actor;
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(422).send({
        error: {
          code: "VALIDATION",
          message: error.issues[0]?.message ?? "输入不合法",
          details: error.issues,
        },
      });
    if (error instanceof DomainError)
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    app.log.error(error);
    const status = (error as { statusCode?: number }).statusCode;
    return reply.code(status && status < 500 ? status : 500).send({
      error: {
        code: "REQUEST_ERROR",
        message:
          status && status < 500
            ? (error as Error).message
            : "服务暂时不可用，请稍后重试",
      },
    });
  });
  await authRoutes(app, db, config, (actor, sample) =>
    seedWorkspace(service, actor, sample),
  );
  await oauthRoutes(app, db, config.publicUrl);
  await mcpRoutes(app, service, config.publicUrl);
  claudePluginRoutes(app, config.publicUrl);
  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { status: "ok" };
  });
  app.get("/api/openapi.json", async () => app.swagger());
  app.get("/api/v1/schema", async (req) => {
    authorize(req.actor, "read");
    return recordContract;
  });
  app.get("/api/bootstrap", async (req) => ({
    records: await service.list(req.actor),
    actor: req.actor,
    sample:
      (
        await db.query<{ value: boolean }>(
          "SELECT value FROM settings WHERE key='sample'",
        )
      ).rows[0]?.value ?? false,
  }));
  const bodySchema = {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string" },
      taskId: { type: ["string", "null"] },
      projectId: { type: ["string", "null"] },
      data: { type: "object", additionalProperties: true },
      approve: { type: "boolean" },
    },
  };
  const key = (headers: Record<string, unknown>) =>
    typeof headers["idempotency-key"] === "string"
      ? headers["idempotency-key"]
      : undefined;
  const id = (params: unknown) => z.object({ id: z.string() }).parse(params).id;
  const version = (raw: unknown) =>
    z
      .object({ expectedVersion: z.number().int().positive() })
      .passthrough()
      .parse(raw).expectedVersion;
  app.get("/api/v1/records", async (req) => {
    const q = z
      .object({
        kind: z.enum(kinds).optional(),
        taskId: z.string().optional(),
        q: z.string().optional(),
        starred: z.enum(["true", "false"]).optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    let data = await service.list(
      req.actor,
      q.kind,
      q.taskId,
      q.starred === undefined ? undefined : q.starred === "true",
    );
    if (q.q) {
      const term = q.q.toLowerCase();
      data = data.filter((e) =>
        (e.title + " " + e.body + " " + e.key).toLowerCase().includes(term),
      );
    }
    return {
      data: data.slice(q.offset, q.offset + q.limit),
      total: data.length,
      nextOffset: q.offset + q.limit < data.length ? q.offset + q.limit : null,
    };
  });
  app.post("/api/v1/records", async (req) => ({
    data: await service.create(req.actor, req.body, key(req.headers)),
  }));
  app.get("/api/v1/records/:id", async (req) => ({
    data: await service.read(req.actor, id(req.params)),
  }));
  app.patch("/api/v1/records/:id", async (req) => {
    const p = z
      .object({
        expectedVersion: z.number().int().positive(),
        title: z.string().optional(),
        body: z.string().optional(),
        data: z.record(z.unknown()).optional(),
      })
      .strict()
      .parse(req.body);
    const { expectedVersion, ...patch } = p;
    return {
      data: await service.update(
        req.actor,
        id(req.params),
        expectedVersion,
        patch,
        key(req.headers),
      ),
    };
  });
  app.get("/api/v1/records/:id/revisions", async (req) => ({
    data: await service.history(req.actor, id(req.params)),
  }));
  app.post("/api/v1/records/:id/star", async (req) => {
    const body = z.object({ starred: z.boolean() }).strict().parse(req.body);
    return {
      data: await service.setStarred(
        req.actor,
        id(req.params),
        body.starred,
        key(req.headers),
      ),
    };
  });
  app.post("/api/v1/records/:id/transitions", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        status: z.string(),
      })
      .parse(req.body);
    return {
      data: await service.changeStatus(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.status,
        key(req.headers),
      ),
    };
  });
  app.post("/api/v1/records/:id/approve", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        comment: z.string().max(2000).default(""),
      })
      .parse(req.body);
    return {
      data: await service.approve(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.comment,
        key(req.headers),
      ),
    };
  });
  app.post("/api/v1/records/:id/review", async (req) => ({
    data: await service.requestReview(
      req.actor,
      id(req.params),
      version(req.body),
      key(req.headers),
    ),
  }));
  app.post("/api/v1/records/:id/archive", async (req) => ({
    data: await service.archive(req.actor, id(req.params), version(req.body)),
  }));
  const plurals: Record<string, Kind> = {
    projects: "project",
    tasks: "task",
    requirements: "requirement",
    "requirement-groups": "requirement_group",
    criteria: "criterion",
    designs: "design",
    "work-items": "work_item",
    issues: "issue",
    "quality-checks": "check",
    "test-cases": "check",
    "quality-runs": "result",
    todos: "todo",
    principles: "principle",
    questions: "question",
  };
  for (const [plural, kind] of Object.entries(plurals)) {
    app.get(
      "/api/v1/" + plural,
      { schema: { tags: [plural], summary: "列出" + plural } },
      async (req) => ({
        data: await service.list(
          req.actor,
          kind,
          (req.query as { taskId?: string }).taskId,
        ),
      }),
    );
    app.post(
      "/api/v1/" + plural,
      {
        schema: { tags: [plural], summary: "创建" + plural, body: bodySchema },
      },
      async (req) => ({
        data: await service.create(
          req.actor,
          { ...(req.body as object), kind },
          key(req.headers),
        ),
      }),
    );
    if (!["project", "task"].includes(kind))
      app.post(
        "/api/v1/tasks/:id/" + plural,
        { schema: { tags: [plural], body: bodySchema } },
        async (req) => ({
          data: await service.create(
            req.actor,
            { ...(req.body as object), kind, taskId: id(req.params) },
            key(req.headers),
          ),
        }),
      );
  }
  app.get("/api/v1/tasks/:id/context", async (req) => ({
    data: await service.context(req.actor, id(req.params)),
  }));
  app.get("/api/v1/tasks/:id/traceability", async (req) => ({
    data: (await service.report(req.actor, id(req.params))).traceability,
  }));
  for (const action of ["reject", "delete", "restore"] as const)
    app.post("/api/v1/requirements/:id/" + action, async (req) => {
      const b = z
        .object({
          expectedVersion: z.number().int().positive(),
          reason: z.string().trim().max(2000).default(""),
        })
        .parse(req.body);
      return {
        data: await service.disposeRequirement(
          req.actor,
          id(req.params),
          b.expectedVersion,
          action,
          b.reason,
          key(req.headers),
        ),
      };
    });
  app.post("/api/v1/todos/:id/assign", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        taskId: z.string().min(1).nullable(),
      })
      .parse(req.body);
    return {
      data: await service.assignTodo(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.taskId,
        key(req.headers),
      ),
    };
  });
  app.get("/api/v1/tasks/:id/acceptance-matrix", async (req) => ({
    data: await service.report(req.actor, id(req.params)),
  }));
  app.get("/api/v1/tasks/:id/completion-check", async (req) => ({
    data: (await service.report(req.actor, id(req.params))).gaps,
  }));
  app.post("/api/v1/tasks/:id/acceptances", async (req) => ({
    data: await service.accept(
      req.actor,
      id(req.params),
      version(req.body),
      key(req.headers),
    ),
  }));
  app.post("/api/v1/tasks/:id/principle-adoptions", async (req) => ({
    data: await service.adoptPrinciples(
      req.actor,
      id(req.params),
      version(req.body),
    ),
  }));
  app.post("/api/v1/criteria/:id/waivers", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    return {
      data: await service.waive(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.reason,
      ),
    };
  });
  app.post("/api/v1/tasks/:id/principle-checks", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        principleId: z.string(),
        note: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    return {
      data: await service.confirmPrinciple(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.principleId,
        b.note,
        key(req.headers),
      ),
    };
  });
  app.post("/api/v1/todos/:id/convert", async (req) => {
    const b = z
      .object({
        expectedVersion: z.number().int().positive(),
        projectId: z.string(),
      })
      .parse(req.body);
    return {
      data: await service.convertTodo(
        req.actor,
        id(req.params),
        b.expectedVersion,
        b.projectId,
        key(req.headers),
      ),
    };
  });
  app.get("/api/v1/events", async (req) =>
    service.events(
      req.actor,
      z
        .object({ after: z.coerce.number().int().min(0).default(0) })
        .parse(req.query).after,
    ),
  );
  app.get("/api/v1/inbox", async (req) => {
    const all = await service.list(req.actor);
    return {
      data: currentWorkspaceRecords(all).filter(
        (e) =>
          ([
            "requirement",
            "criterion",
            "design",
            "check",
            "principle",
          ].includes(e.kind) &&
            e.approvedVersion !== e.version) ||
          (e.kind === "issue" &&
            e.data.blocking &&
            !["verified", "closed"].includes(e.status)) ||
          (e.kind === "question" && e.status === "open"),
      ),
    };
  });
  app.post("/api/v1/tasks/:id/report-snapshots", async (req) => ({
    data: await service.saveReport(req.actor, id(req.params), key(req.headers)),
  }));
  app.get("/api/v1/tasks/:id/reports", async (req) => {
    await service.read(req.actor, id(req.params));
    return {
      data: (
        await db.query(
          "SELECT id,kind,created_at FROM reports WHERE task_id=$1 ORDER BY created_at DESC",
          [id(req.params)],
        )
      ).rows,
    };
  });
  app.get("/api/v1/report-snapshots/:id", async (req) => {
    const row = (
      await db.query<{ task_id: string; data: unknown }>(
        "SELECT task_id,data FROM reports WHERE id=$1",
        [id(req.params)],
      )
    ).rows[0];
    ensure(row, "NOT_FOUND", "报告不存在", 404);
    await service.read(req.actor, row.task_id);
    return { data: row.data };
  });
  app.get("/api/v1/tasks/:id/export", async (req, reply) => {
    const report = await service.report(req.actor, id(req.params));
    const format = (req.query as { format?: string }).format;
    if (format === "csv")
      return reply
        .header(
          "Content-Disposition",
          'attachment; filename="workhub-matrix.csv"',
        )
        .type("text/csv; charset=utf-8")
        .send(reportCsv(report.rows));
    if (format === "markdown") {
      const md =
        `# ${report.task.title}\n\n生成时间：${report.asOf}\n\n当前验证：${report.metrics.passed}/${report.metrics.total}\n\n` +
        report.rows
          .map(
            (r) => `- ${r.criterion.title.replace(/[\r\n]/g, " ")}：${r.state}`,
          )
          .join("\n");
      return reply.type("text/markdown; charset=utf-8").send(md);
    }
    return reply
      .header(
        "Content-Disposition",
        'attachment; filename="workhub-report.json"',
      )
      .send(report);
  });
  app.get("/api/v1/workspace/export", async (req) => {
    authorize(req.actor, "configure");
    return db.transaction(async (tx) => {
      await service.lock(tx);
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        records: await service.all(tx),
        revisions: (await tx.query("SELECT * FROM revisions")).rows,
        reviews: (await tx.query("SELECT * FROM reviews")).rows,
        reports: (await tx.query("SELECT * FROM reports")).rows,
        events: (await tx.query("SELECT * FROM events")).rows,
      };
    });
  });
  app.get("/api/settings/llm", async (req) =>
    assistant.publicConfig(req.actor),
  );
  app.put("/api/settings/llm", async (req) =>
    assistant.configure(req.actor, req.body),
  );
  app.delete("/api/settings/llm", async (req) => assistant.remove(req.actor));
  app.post("/api/assistant/runs", async (req, reply) => {
    const b = z
      .object({
        question: z.string(),
        taskId: z.string().optional(),
        summary: z.boolean().default(false),
      })
      .parse(req.body);
    return reply
      .code(202)
      .send(
        await assistant.enqueue(req.actor, b.question, b.taskId, b.summary),
      );
  });
  app.get("/api/assistant/runs/:id", async (req) =>
    assistant.get(req.actor, id(req.params)),
  );
  app.post("/api/assistant/runs/:id/cancel", async (req) =>
    assistant.cancel(req.actor, id(req.params)),
  );
  app.get("/api/tasks/:id/summary", async (req) =>
    assistant.summaryState(req.actor, id(req.params)),
  );
  const root = config.staticRoot ?? resolve("dist");
  if (existsSync(root)) {
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: { message: "接口不存在" } })
        : reply.type("text/html").sendFile("index.html"),
    );
  }
  return { app, service, assistant };
}
