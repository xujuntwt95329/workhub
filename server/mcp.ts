import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { Service } from "./service.js";
import { actorFor, createAgentToken } from "./auth.js";
import { digest, randomToken, safeRedirect } from "./security.js";
import { type Actor, kinds, ensure } from "../shared/domain.js";
import type { Database } from "./db.js";
import { recordContract } from "./contract.js";
const output = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
export function createMcpServer(service: Service, actor: Actor) {
  const server = new McpServer({ name: "workhub", version: "0.1.0" });
  server.registerResource(
    "workhub-schema",
    "workhub://schema",
    { mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "workhub://schema",
          mimeType: "application/json",
          text: JSON.stringify(recordContract),
        },
      ],
    }),
  );
  server.registerTool(
    "get_task_context",
    {
      description: "读取指定任务的目标、确认版本、原则、问题和质量矩阵。",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => output(await service.context(actor, taskId)),
  );
  server.registerTool(
    "list_records",
    {
      description: "按类型、任务或重点关注状态读取工程记录。",
      inputSchema: {
        kind: z.enum(kinds).optional(),
        taskId: z.string().optional(),
        starred: z.boolean().optional(),
      },
    },
    async ({ kind, taskId, starred }) =>
      output(await service.list(actor, kind, taskId, starred)),
  );
  server.registerTool(
    "set_record_star",
    {
      description:
        "设置或取消工程条目的重点关注标记；不改变内容版本、审批或测试证据。标记在工作空间内共享。",
      inputSchema: {
        id: z.string(),
        starred: z.boolean(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, starred, idempotencyKey }) =>
      output(await service.setStarred(actor, id, starred, idempotencyKey)),
  );
  server.registerTool(
    "create_record",
    {
      description:
        "创建任务、需求、设计、待办、原则草稿、问题或质量结果。审批由 Owner 完成。",
      inputSchema: {
        kind: z.enum(kinds),
        title: z.string(),
        body: z.string().optional(),
        taskId: z.string().optional(),
        projectId: z.string().optional(),
        data: z.record(z.unknown()).optional(),
        idempotencyKey: z.string(),
      },
    },
    async ({ idempotencyKey, ...input }) =>
      output(await service.create(actor, input, idempotencyKey)),
  );
  server.registerTool(
    "update_record",
    {
      description: "按读取过的版本修改工程内容；版本冲突时请重新读取。",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int(),
        title: z.string().optional(),
        body: z.string().optional(),
        data: z.record(z.unknown()).optional(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, expectedVersion, idempotencyKey, ...patch }) =>
      output(
        await service.update(actor, id, expectedVersion, patch, idempotencyKey),
      ),
  );
  server.registerTool(
    "transition_record",
    {
      description: "更新任务、实施事项、待办或问题状态。不能替代最终验收。",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int(),
        status: z.string(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, expectedVersion, status, idempotencyKey }) =>
      output(
        await service.changeStatus(
          actor,
          id,
          expectedVersion,
          status,
          idempotencyKey,
        ),
      ),
  );
  server.registerTool(
    "request_review",
    {
      description: "请求 Owner 评审指定版本。",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, expectedVersion, idempotencyKey }) =>
      output(
        await service.requestReview(actor, id, expectedVersion, idempotencyKey),
      ),
  );
  server.registerTool(
    "get_quality_matrix",
    {
      description: "获取按确定性规则计算的当前质量覆盖与验收缺口。",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => output(await service.report(actor, taskId)),
  );
  server.registerTool(
    "convert_todo_to_task",
    {
      description: "把想法转换为任务，保留原记录。",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int(),
        projectId: z.string(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, expectedVersion, projectId, idempotencyKey }) =>
      output(
        await service.convertTodo(
          actor,
          id,
          expectedVersion,
          projectId,
          idempotencyKey,
        ),
      ),
  );
  server.registerResource(
    "workhub-guide",
    "workhub://guide",
    { mimeType: "text/plain" },
    async () => ({
      contents: [
        {
          uri: "workhub://guide",
          text: "先读取 workhub://schema 与任务上下文，再使用 create_record/update_record 提交结构化内容。原则必须带 taskId；待办可带 taskId 或通过 assign_todo_to_task 归入任务。需求通过 requirement_group 和 groupId 分组。check 是测试用例，criterionIds 关联多个验收标准；result 必须绑定 requirementVersions、criterionVersions、checkVersion 与实际 codeRef。get_quality_matrix 包含双向 traceability、未关联与过期证据。拒绝/删除需求不属于当前验收范围，恢复由 Owner 操作。内容更新需 expectedVersion，创建与业务动作需稳定 idempotencyKey。重点关注通过 set_record_star 设置，list_records 的 starred 参数可筛选关注项；关注不改变内容版本，无需 expectedVersion。不要把自报测试结论当作人工验收。",
        },
      ],
    }),
  );
  server.registerTool(
    "assign_todo_to_task",
    {
      description: "将待办归入指定任务；受来源和目标任务权限限制。",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int().positive(),
        taskId: z.string().nullable(),
        idempotencyKey: z.string(),
      },
    },
    async ({ id, expectedVersion, taskId, idempotencyKey }) =>
      output(
        await service.assignTodo(
          actor,
          id,
          expectedVersion,
          taskId,
          idempotencyKey,
        ),
      ),
  );
  return server;
}
export async function mcpRoutes(
  app: FastifyInstance,
  service: Service,
  publicUrl: string,
) {
  app.post("/mcp", async (req, reply) => {
    const actor = await actorFor(service.db, req);
    if (!actor)
      return reply
        .code(401)
        .header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"`,
        )
        .send({ error: "unauthorized" });
    const server = createMcpServer(service, actor),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    await server.connect(transport);
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  for (const method of ["GET", "DELETE"] as const)
    app.route({
      method,
      url: "/mcp",
      handler: async (_req, reply) =>
        reply.code(405).send({ error: "method_not_allowed" }),
    });
}
const authQuery = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.string(),
  state: z.string().min(1).max(1000),
  scope: z.string().optional(),
});
export async function oauthRoutes(
  app: FastifyInstance,
  db: Database,
  url: string,
) {
  const resource = url + "/mcp";
  app.get("/.well-known/oauth-protected-resource/mcp", async () => ({
    resource,
    authorization_servers: [url],
    scopes_supported: ["workhub:read", "workhub:write"],
    bearer_methods_supported: ["header"],
  }));
  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: url,
    authorization_endpoint: url + "/oauth/authorize",
    token_endpoint: url + "/oauth/token",
    registration_endpoint: url + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["workhub:read", "workhub:write"],
  }));
  app.post(
    "/oauth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const input = z
        .object({
          client_name: z.string().trim().min(1).max(100).default("MCP Client"),
          redirect_uris: z.array(z.string()).min(1).max(5),
          token_endpoint_auth_method: z.literal("none").optional(),
        })
        .passthrough()
        .parse(req.body);
      ensure(
        input.redirect_uris.every(safeRedirect),
        "INVALID_REDIRECT",
        "回调地址必须为 HTTPS 或本机 HTTP",
      );
      const id = randomUUID();
      await db.query(
        "INSERT INTO oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3)",
        [id, input.client_name, JSON.stringify(input.redirect_uris)],
      );
      return {
        client_id: id,
        client_name: input.client_name,
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      };
    },
  );
  async function validate(raw: unknown) {
    const q = authQuery.parse(raw);
    const c = (
      await db.query<{ name: string; redirect_uris: string[] }>(
        "SELECT * FROM oauth_clients WHERE id=$1",
        [q.client_id],
      )
    ).rows[0];
    ensure(
      c && c.redirect_uris.includes(q.redirect_uri),
      "INVALID_CLIENT",
      "客户端或回调地址不匹配",
    );
    ensure(q.resource === resource, "INVALID_RESOURCE", "请求的资源地址不匹配");
    q.scope ??= "workhub:read workhub:write";
    const scopes = q.scope.split(/\s+/);
    ensure(
      scopes.includes("workhub:read") &&
        scopes.every((s) => ["workhub:read", "workhub:write"].includes(s)),
      "INVALID_SCOPE",
      "授权范围不受支持",
    );
    return { q, name: c.name };
  }
  app.get("/oauth/authorize", async (req, reply) => {
    await validate(req.query);
    const query = new URLSearchParams(req.query as Record<string, string>);
    return reply.redirect("/authorize?" + query.toString());
  });
  app.get("/api/oauth/request", async (req) => {
    ensure(req.actor.role === "owner", "FORBIDDEN", "需要 Owner 登录", 403);
    const { q, name } = await validate(req.query);
    return {
      name,
      redirectUri: q.redirect_uri,
      scope: q.scope!.includes("workhub:write")
        ? "读取和修改所有任务；不能批准或验收"
        : "只读访问所有任务",
    };
  });
  app.post("/api/oauth/authorize", async (req) => {
    ensure(req.actor.role === "owner", "FORBIDDEN", "需要 Owner 登录", 403);
    const { q } = await validate(req.body);
    const code = randomToken();
    await db.query(
      "INSERT INTO oauth_codes(hash,client_id,redirect_uri,challenge,resource,expires_at,scope) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        digest(code),
        q.client_id,
        q.redirect_uri,
        q.code_challenge,
        resource,
        new Date(Date.now() + 300000).toISOString(),
        q.scope,
      ],
    );
    const target = new URL(q.redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", q.state);
    target.searchParams.set("iss", url);
    return { redirect: target.href };
  });
  app.post(
    "/oauth/token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
      const input = z
        .object({
          grant_type: z.enum(["authorization_code", "refresh_token"]),
          client_id: z.string(),
          code: z.string().optional(),
          redirect_uri: z.string().optional(),
          code_verifier: z.string().min(43).max(128).optional(),
          refresh_token: z.string().optional(),
          resource: z.string().optional(),
        })
        .passthrough()
        .parse(req.body);
      ensure(
        !input.resource || input.resource === resource,
        "INVALID_RESOURCE",
        "资源地址不匹配",
      );
      return db.transaction(async (tx) => {
        await new Service(db).lock(tx);
        let permissions = ["read"];
        if (input.grant_type === "authorization_code") {
          ensure(
            input.code && input.code_verifier && input.redirect_uri,
            "INVALID_GRANT",
            "缺少授权参数",
          );
          const c = (
            await tx.query<{
              client_id: string;
              redirect_uri: string;
              challenge: string;
              used: boolean;
              expires_at: Date;
              scope: string;
            }>("SELECT * FROM oauth_codes WHERE hash=$1 FOR UPDATE", [
              digest(input.code),
            ])
          ).rows[0];
          ensure(
            c &&
              !c.used &&
              new Date(c.expires_at).getTime() > Date.now() &&
              c.client_id === input.client_id &&
              c.redirect_uri === input.redirect_uri,
            "INVALID_GRANT",
            "授权码无效或已过期",
            400,
          );
          ensure(
            createHash("sha256")
              .update(input.code_verifier)
              .digest("base64url") === c.challenge,
            "INVALID_GRANT",
            "PKCE 校验失败",
          );
          await tx.query("UPDATE oauth_codes SET used=true WHERE hash=$1", [
            digest(input.code),
          ]);
          if (c.scope.includes("workhub:write")) permissions.push("write");
        } else {
          ensure(input.refresh_token, "INVALID_GRANT", "缺少刷新令牌");
          const r = (
            await tx.query<{
              client_id: string;
              token_id: string;
              used: boolean;
              expires_at: Date;
            }>("SELECT * FROM oauth_refresh WHERE hash=$1 FOR UPDATE", [
              digest(input.refresh_token),
            ])
          ).rows[0];
          ensure(
            r &&
              !r.used &&
              r.client_id === input.client_id &&
              new Date(r.expires_at).getTime() > Date.now(),
            "INVALID_GRANT",
            "刷新令牌无效",
          );
          const previous = (
            await tx.query<{ permissions: string[] }>(
              "SELECT permissions FROM tokens WHERE id=$1 AND revoked=false",
              [r.token_id],
            )
          ).rows[0];
          ensure(previous, "INVALID_GRANT", "授权已撤销");
          permissions = previous.permissions;
          await tx.query("UPDATE oauth_refresh SET used=true WHERE hash=$1", [
            digest(input.refresh_token),
          ]);
          await tx.query("UPDATE tokens SET revoked=true WHERE id=$1", [
            r.token_id,
          ]);
        }
        const token = await createAgentToken(
          tx,
          "MCP " + input.client_id,
          ["*"],
          permissions,
          1 / 24,
        );
        const refresh = randomToken();
        await tx.query(
          "INSERT INTO oauth_refresh(hash,client_id,token_id,expires_at) VALUES($1,$2,$3,$4)",
          [
            digest(refresh),
            input.client_id,
            token.id,
            new Date(Date.now() + 30 * 86400000).toISOString(),
          ],
        );
        return {
          access_token: token.token,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: refresh,
          scope: permissions.map((p) => "workhub:" + p).join(" "),
        };
      });
    },
  );
}
