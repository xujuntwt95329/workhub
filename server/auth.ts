import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import { type Actor, ensure, authorize } from "../shared/domain.js";
import {
  digest,
  randomToken,
  hashPassword,
  verifyPassword,
} from "./security.js";
import { Service } from "./service.js";
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}
export type AuthConfig = {
  publicUrl: string;
  production: boolean;
  setupToken?: string;
  demo?: boolean;
};
export async function createAgentToken(
  db: Sql,
  name: string,
  taskIds: string[],
  permissions: string[],
  days = 30,
) {
  const token = randomToken(),
    id = randomUUID();
  await db.query(
    "INSERT INTO tokens(id,hash,name,task_ids,permissions,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      digest(token),
      name,
      JSON.stringify(taskIds),
      JSON.stringify(permissions),
      new Date(Date.now() + days * 86400000).toISOString(),
    ],
  );
  return { id, token };
}
export async function actorFor(
  db: Database,
  request: FastifyRequest,
): Promise<Actor | undefined> {
  const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    const row = (
      await db.query<{
        id: string;
        name: string;
        task_ids: string[];
        permissions: string[];
      }>(
        "SELECT * FROM tokens WHERE hash=$1 AND revoked=false AND expires_at>now()",
        [digest(bearer)],
      )
    ).rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          role: "agent",
          taskIds: row.task_ids,
          permissions: row.permissions,
        }
      : undefined;
  }
  const token = request.cookies?.workhub_session;
  if (!token) return;
  const row = (
    await db.query<{ id: string; name: string }>(
      "SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        role: "owner",
        taskIds: ["*"],
        permissions: ["read", "write"],
      }
    : undefined;
}
export async function authRoutes(
  app: FastifyInstance,
  db: Database,
  config: AuthConfig,
  onSetup: (actor: Actor, sample: boolean) => Promise<void>,
) {
  const service = new Service(db);
  async function session(reply: FastifyReply, id: string) {
    const value = randomToken();
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,$3)",
      [digest(value), id, new Date(Date.now() + 7 * 86400000).toISOString()],
    );
    reply.setCookie("workhub_session", value, {
      path: "/",
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      maxAge: 7 * 86400,
    });
  }
  app.get("/api/auth/status", async (req) => ({
    initialized:
      (await db.query("SELECT id FROM users LIMIT 1")).rows.length > 0,
    actor: await actorFor(db, req),
    demo: !!config.demo,
  }));
  app.post(
    "/api/auth/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(60),
          password: z.string().min(10).max(200),
          setupToken: z.string().optional(),
          sample: z.boolean().default(false),
        })
        .parse(req.body);
      if (config.setupToken)
        ensure(
          input.setupToken === config.setupToken,
          "SETUP_TOKEN",
          "初始化密钥不正确",
          403,
        );
      const id = randomUUID();
      const hash = await hashPassword(input.password);
      await db.transaction(async (tx) => {
        await service.lock(tx);
        ensure(
          !(await tx.query("SELECT id FROM users LIMIT 1")).rows.length,
          "ALREADY_INITIALIZED",
          "工作空间已初始化",
          409,
        );
        await tx.query(
          "INSERT INTO users(id,name,password_hash) VALUES($1,$2,$3)",
          [id, input.name, hash],
        );
      });
      const actor: Actor = {
        id,
        name: input.name,
        role: "owner",
        taskIds: ["*"],
        permissions: ["read", "write"],
      };
      await onSetup(actor, input.sample);
      await session(reply, id);
      return { actor };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = z
        .object({ name: z.string().max(60), password: z.string().max(200) })
        .parse(req.body);
      const user = (
        await db.query<{ id: string; name: string; password_hash: string }>(
          "SELECT * FROM users WHERE name=$1",
          [input.name],
        )
      ).rows[0];
      ensure(
        user && (await verifyPassword(input.password, user.password_hash)),
        "INVALID_CREDENTIALS",
        "用户名或密码不正确",
        401,
      );
      await session(reply, user.id);
      return { ok: true };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.workhub_session)
      await db.query("DELETE FROM sessions WHERE hash=$1", [
        digest(req.cookies.workhub_session),
      ]);
    reply.clearCookie("workhub_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/tokens", async (req) => {
    authorize(req.actor, "configure");
    return {
      data: (
        await db.query(
          "SELECT id,name,task_ids,permissions,expires_at,revoked FROM tokens ORDER BY name",
        )
      ).rows,
    };
  });
  app.post("/api/tokens", async (req) => {
    authorize(req.actor, "configure");
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        taskIds: z.array(z.string()).min(1),
        permissions: z
          .array(z.enum(["read", "write", "assistant:invoke"]))
          .min(1),
        days: z.number().int().min(1).max(365).default(30),
      })
      .parse(req.body);
    for (const id of input.taskIds)
      if (id !== "*")
        ensure(
          (await service.get(id)).kind === "task",
          "INVALID_SCOPE",
          "授权任务不存在",
        );
    return await createAgentToken(
      db,
      input.name,
      input.taskIds,
      input.permissions,
      input.days,
    );
  });
  app.delete("/api/tokens/:id", async (req) => {
    authorize(req.actor, "configure");
    await db.query("UPDATE tokens SET revoked=true WHERE id=$1", [
      (req.params as { id: string }).id,
    ]);
    return { ok: true };
  });
}
