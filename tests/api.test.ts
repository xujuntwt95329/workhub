import { beforeAll, beforeEach, afterEach, afterAll, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { openDatabase, type Database } from "../server/db";
import { buildApp } from "../server/app";
import { owner } from "../server/service";
import { clear, readyTask } from "./fixtures";
let db: Database, hub: Awaited<ReturnType<typeof buildApp>>, cookie: string;
beforeAll(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL);
});
beforeEach(async () => {
  await clear(db);
  hub = await buildApp(db, {
    publicUrl: "http://127.0.0.1:5173",
    production: false,
    encryptionKey: Buffer.alloc(32, 7),
    allowedLlmOrigins: ["https://model.example"],
    setupToken: "setup-test",
  });
  const res = await hub.app.inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: {
      name: "Alice",
      password: "correct-horse-2026",
      setupToken: "setup-test",
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  cookie = res.headers["set-cookie"]!.toString().split(";")[0];
});
afterEach(async () => hub.app.close());
afterAll(async () => db.close());
const request = (
  method: any,
  url: string,
  payload?: any,
  headers: Record<string, string> = {},
) => hub.app.inject({ method, url, payload, headers: { cookie, ...headers } });

it("sets focus with strict input, filters before pagination, and enforces token scopes", async () => {
  const f = await readyTask(hub.service);
  const base = "/api/v1/records/" + f.requirement.id;
  const marked = await request("POST", base + "/star", { starred: true });
  expect(marked.statusCode, marked.body).toBe(200);
  expect(marked.json().data).toEqual({ ...f.requirement, starred: true });
  await hub.service.setStarred(owner, f.criterion.id, true);
  const page = (
    await request(
      "GET",
      "/api/v1/records?starred=true&limit=1&offset=1&taskId=" + f.task.id,
    )
  ).json();
  expect(page.total).toBe(2);
  expect(page.nextOffset).toBe(null);
  expect(page.data[0].id).toBe(f.criterion.id);
  expect(
    (await request("GET", "/api/v1/records?starred=false")).json().total,
  ).toBe((await hub.service.all()).length - 2);
  expect(
    (
      await request(
        "GET",
        "/api/v1/records?starred=true&kind=requirement&q=articles",
      )
    ).json().total,
  ).toBe(1);
  expect(
    (await request("GET", "/api/v1/records?starred=invalid")).statusCode,
  ).toBe(422);
  for (const payload of [
    {},
    { starred: "true" },
    { starred: 1 },
    { starred: null },
    { starred: true, title: "Changed" },
  ])
    expect((await request("POST", base + "/star", payload)).statusCode).toBe(
      422,
    );
  expect(
    (await request("PATCH", base, { expectedVersion: 1, starred: true }))
      .statusCode,
  ).toBe(422);
  const other = await hub.service.create(owner, {
    kind: "task",
    title: "Another task",
    projectId: f.project.id,
  });
  for (const taskIds of [[f.task.id], [other.id]]) {
    const tokenResponse = await request("POST", "/api/tokens", {
      name: "Read only focus",
      taskIds,
      permissions: taskIds[0] === f.task.id ? ["read"] : ["read", "write"],
      days: 7,
    });
    expect(tokenResponse.statusCode, tokenResponse.body).toBe(200);
    const headers = { authorization: "Bearer " + tokenResponse.json().token };
    const denied = await hub.app.inject({
      method: "POST",
      url: base + "/star",
      payload: { starred: false },
      headers,
    });
    expect(denied.statusCode).toBe(403);
    const list = await hub.app.inject({
      method: "GET",
      url: "/api/v1/records?starred=true",
      headers,
    });
    expect(list.json().total).toBe(taskIds[0] === f.task.id ? 2 : 0);
  }
  expect(
    (await request("POST", base + "/star", { starred: false })).json().data,
  ).toEqual(f.requirement);
});

it("exposes task-owned content, requirement groups, lifecycle and traceability through public APIs", async () => {
  const f = await readyTask(hub.service);
  const create = async (path: string, data: object) => {
    const response = await request("POST", path, data);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data;
  };
  const base = "/api/v1/tasks/" + f.task.id;
  const group = await create(base + "/requirement-groups", {
    title: "Search",
  });
  await request("PATCH", "/api/v1/records/" + f.requirement.id, {
    expectedVersion: 1,
    data: { groupId: group.id },
  });
  const todo = await create("/api/v1/todos", { title: "Follow up" });
  const assigned = await create("/api/v1/todos/" + todo.id + "/assign", {
    expectedVersion: 1,
    taskId: f.task.id,
  });
  expect(assigned.taskId).toBe(f.task.id);
  const scoped = await create(base + "/todos", { title: "Task idea" });
  expect(scoped.projectId).toBe(f.project.id);
  const p = await create(base + "/principles", {
    title: "Safety first",
    approve: true,
  });
  expect(p.taskId).toBe(f.task.id);
  expect(
    (await request("POST", "/api/v1/principles", { title: "Global" }))
      .statusCode,
  ).toBe(400);
  const testCase = await create(base + "/test-cases", {
    title: "New case",
    data: {
      criterionIds: [f.criterion.id],
      steps: "Search across 100 articles",
      expectedResult: "Every matching article appears once",
    },
  });
  expect(
    (await request("GET", "/api/v1/test-cases?taskId=" + f.task.id))
      .json()
      .data.map((r: any) => r.id),
  ).toContain(testCase.id);
  let graph = (await request("GET", base + "/traceability")).json().data;
  expect(graph.cases[0].links[0].requirement.id).toBe(f.requirement.id);
  expect(graph.cases[0].state).toBe("stale");
  const rejected = await create(
    "/api/v1/requirements/" + f.requirement.id + "/reject",
    { expectedVersion: 2, reason: "Future iteration" },
  );
  expect(rejected.status).toBe("rejected");
  expect(
    (await request("GET", "/api/v1/inbox")).json().data.map((r: any) => r.id),
  ).not.toContain(f.requirement.id);
  expect(
    (await request("GET", "/api/v1/inbox")).json().data.map((r: any) => r.id),
  ).not.toContain(f.criterion.id);
  graph = (await request("GET", base + "/traceability")).json().data;
  expect(graph.rows).toHaveLength(0);
  expect(graph.cases.every((r: any) => r.state === "out_of_scope")).toBe(true);
  await create("/api/v1/requirements/" + f.requirement.id + "/delete", {
    expectedVersion: 3,
    reason: "Retire",
  });
  const restored = await create(
    "/api/v1/requirements/" + f.requirement.id + "/restore",
    { expectedVersion: 4 },
  );
  expect(restored.status).toBe("draft");
  expect(
    (
      await request(
        "POST",
        "/api/v1/requirements/" + f.requirement.id + "/reject",
        { expectedVersion: 5 },
      )
    ).statusCode,
  ).toBe(400);
});

it("protects initialization, login, logout, sessions and request origins", async () => {
  expect((await request("GET", "/api/auth/status")).json().actor.name).toBe(
    "Alice",
  );
  expect(
    (
      await request("POST", "/api/auth/setup", {
        name: "Bob",
        password: "long-password",
        setupToken: "setup-test",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("POST", "/api/auth/login", {
        name: "Alice",
        password: "wrong",
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await request("POST", "/api/auth/login", {
        name: "Alice",
        password: "correct-horse-2026",
      })
    ).headers["set-cookie"],
  ).toContain("HttpOnly");
  expect(
    (
      await request(
        "POST",
        "/api/v1/todos",
        { title: "CSRF" },
        { origin: "https://evil.example" },
      )
    ).statusCode,
  ).toBe(403);
  await request("POST", "/api/auth/logout", {});
  expect((await request("GET", "/api/bootstrap")).statusCode).toBe(401);
  expect((await request("GET", "/health")).json()).toEqual({ status: "ok" });
});
it("requires the deployment setup token and validates input", async () => {
  await clear(db);
  expect((await request("GET", "/api/auth/status")).json().initialized).toBe(
    false,
  );
  expect(
    (
      await request("POST", "/api/auth/setup", {
        name: "Alice",
        password: "correct-horse-2026",
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request("POST", "/api/auth/setup", {
        name: "Alice",
        password: "short",
      })
    ).statusCode,
  ).toBe(422);
});
it("provides one CRUD contract, version conflicts, history, reviews and filtered pagination", async () => {
  const f = await readyTask(hub.service);
  const result = await request(
    "POST",
    `/api/v1/tasks/${f.task.id}/designs`,
    { title: "Search architecture", body: "A", data: { required: true } },
    { "idempotency-key": "design-1" },
  );
  expect(result.statusCode, result.body).toBe(200);
  const d = result.json().data;
  expect(
    (
      await request(
        "POST",
        `/api/v1/tasks/${f.task.id}/designs`,
        {
          title: "Search architecture",
          body: "A",
          data: { required: true },
        },
        { "idempotency-key": "design-1" },
      )
    ).json().data.id,
  ).toBe(d.id);
  expect(
    (
      await request("PATCH", "/api/v1/records/" + d.id, {
        expectedVersion: 1,
        body: "B",
      })
    ).json().data.version,
  ).toBe(2);
  expect(
    (
      await request("PATCH", "/api/v1/records/" + d.id, {
        expectedVersion: 1,
        title: "Lost edit",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("POST", `/api/v1/records/${d.id}/review`, {
        expectedVersion: 2,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request("POST", `/api/v1/records/${d.id}/approve`, {
        expectedVersion: 2,
        comment: "Good",
      })
    ).json().data.approvedVersion,
  ).toBe(2);
  expect(
    (await request("GET", `/api/v1/records/${d.id}/revisions`)).json().data,
  ).toHaveLength(2);
  expect(
    (await request("GET", "/api/v1/records?q=architecture&limit=1")).json(),
  ).toMatchObject({ total: 1, nextOffset: null });
  expect(
    (await request("GET", "/api/v1/records?limit=1")).json().nextOffset,
  ).toBe(1);
  expect(
    (await request("GET", "/api/v1/designs?taskId=" + f.task.id)).json().data,
  ).toHaveLength(1);
  expect(
    (await request("GET", "/api/v1/records/" + d.id)).json().data.body,
  ).toBe("B");
  expect(
    (
      await request("POST", `/api/v1/records/${d.id}/archive`, {
        expectedVersion: 2,
      })
    ).json().data.status,
  ).toBe("archived");
  expect(
    (
      await request("PATCH", "/api/v1/records/" + d.id, {
        expectedVersion: 3,
        approvedVersion: 3,
      })
    ).statusCode,
  ).toBe(422);
});
it("validates aliases, generic requests and malformed payloads consistently", async () => {
  expect(
    (await request("POST", "/api/v1/records", { kind: "todo", title: "Idea" }))
      .statusCode,
  ).toBe(200);
  expect((await request("POST", "/api/v1/todos", {})).statusCode).toBe(400);
  expect(
    (
      await request("POST", "/api/v1/records", {
        kind: "task",
        title: "Bad",
        data: { codeRef: "main" },
      })
    ).statusCode,
  ).toBe(422);
  expect((await request("GET", "/api/v1/records?limit=-1")).statusCode).toBe(
    422,
  );
  expect((await request("GET", "/api/v1/records/missing")).statusCode).toBe(
    404,
  );
});
it("issues hashed scoped tokens, rejects owner actions and supports immediate revocation", async () => {
  const f = await readyTask(hub.service);
  const res = await request("POST", "/api/tokens", {
    name: "QA",
    taskIds: [f.task.id],
    permissions: ["read"],
    days: 1,
  });
  const token = res.json();
  const headers = { authorization: "Bearer " + token.token };
  expect(
    (await request("GET", "/api/bootstrap", undefined, headers))
      .json()
      .records.every((r: any) => r.id === f.task.id || r.taskId === f.task.id),
  ).toBe(true);
  expect(
    (await request("POST", "/api/v1/todos", { title: "Forbidden" }, headers))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        "POST",
        `/api/v1/records/${f.requirement.id}/approve`,
        { expectedVersion: 1 },
        headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await request("GET", "/api/v1/workspace/export", undefined, headers))
      .statusCode,
  ).toBe(403);
  expect((await request("GET", "/api/tokens")).body).not.toContain(token.token);
  expect(
    JSON.stringify((await db.query("SELECT * FROM tokens")).rows),
  ).not.toContain(token.token);
  await request("DELETE", "/api/tokens/" + token.id);
  expect(
    (await request("GET", "/api/bootstrap", undefined, headers)).statusCode,
  ).toBe(401);
  expect(
    (
      await request("POST", "/api/tokens", {
        name: "Bad",
        taskIds: [f.project.id],
        permissions: ["read"],
      })
    ).statusCode,
  ).toBe(400);
});
it("exports deterministic reports and freezes report snapshots across subsequent changes", async () => {
  const f = await readyTask(hub.service);
  const base = "/api/v1/tasks/" + f.task.id;
  expect((await request("GET", base + "/context")).json().data.task.id).toBe(
    f.task.id,
  );
  expect(
    (await request("GET", base + "/completion-check")).json().data,
  ).toEqual([]);
  expect(
    (await request("GET", base + "/acceptance-matrix")).json().data.metrics
      .passRate,
  ).toBe(1);
  const snap = (await request("POST", base + "/report-snapshots", {})).json()
    .data;
  expect((await request("GET", base + "/reports")).json().data).toHaveLength(1);
  expect(
    (await request("GET", "/api/v1/report-snapshots/" + snap.id)).json().data
      .rows[0].state,
  ).toBe("passed");
  expect(
    (await request("GET", "/api/v1/report-snapshots/missing")).statusCode,
  ).toBe(404);
  expect(
    (await request("GET", base + "/export?format=csv")).headers["content-type"],
  ).toContain("text/csv");
  expect(
    (await request("GET", base + "/export?format=markdown")).body,
  ).toContain("# Article search");
  expect((await request("GET", base + "/export")).json().metricVersion).toBe(2);
  expect(
    (await request("GET", "/api/v1/events")).json().items.length,
  ).toBeGreaterThan(0);
  const exported = (await request("GET", "/api/v1/workspace/export")).json();
  expect(exported.schemaVersion).toBe(1);
  expect(exported.users).toBeUndefined();
  expect(exported.settings).toBeUndefined();
  expect(exported.tokens).toBeUndefined();
  expect(
    (
      await request("POST", base + "/acceptances", { expectedVersion: 1 })
    ).json().data.status,
  ).toBe("done");
});
it("exposes owner workflow actions and the review inbox", async () => {
  const f = await readyTask(hub.service);
  const todo = (
    await request("POST", "/api/v1/todos", { title: "Future idea" })
  ).json().data;
  expect(
    (
      await request("POST", `/api/v1/todos/${todo.id}/convert`, {
        expectedVersion: 1,
        projectId: f.project.id,
      })
    ).json().data.kind,
  ).toBe("task");
  expect(
    (
      await request("POST", `/api/v1/records/${f.task.id}/transitions`, {
        expectedVersion: 1,
        status: "active",
      })
    ).json().data.status,
  ).toBe("active");
  expect(
    (
      await request("POST", `/api/v1/tasks/${f.task.id}/principle-adoptions`, {
        expectedVersion: 2,
      })
    ).json().data.version,
  ).toBe(3);
  expect(
    (
      await request("POST", `/api/v1/criteria/${f.criterion.id}/waivers`, {
        expectedVersion: 1,
        reason: "Manual alternative accepted",
      })
    ).json().data.data.waiver.reason,
  ).toContain("Manual");
  const issue = (
    await request("POST", `/api/v1/tasks/${f.task.id}/issues`, {
      title: "Blocker",
      data: { blocking: true },
    })
  ).json().data;
  expect(
    (await request("GET", "/api/v1/inbox")).json().data.map((e: any) => e.id),
  ).toContain(issue.id);
});
it("keeps model credentials encrypted and gates assistant execution", async () => {
  expect(
    (await request("POST", "/api/assistant/runs", { question: "Status?" }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await request("PUT", "/api/settings/llm", {
        baseUrl: "https://model.example/v1",
        model: "test",
        apiKey: "sensitive-test-key",
      })
    ).statusCode,
  ).toBe(200);
  const exposed = await request("GET", "/api/settings/llm");
  expect(exposed.body).not.toContain("sensitive-test-key");
  expect(exposed.json().configured).toBe(true);
  expect(
    JSON.stringify(
      (await db.query("SELECT value FROM settings WHERE key='llm'")).rows,
    ),
  ).not.toContain("sensitive-test-key");
  const run = (
    await request("POST", "/api/assistant/runs", { question: "Status?" })
  ).json();
  expect(
    (await request("GET", "/api/assistant/runs/" + run.id)).json().status,
  ).toBe("queued");
  await request("POST", "/api/assistant/runs/" + run.id + "/cancel", {});
  expect(
    (await request("GET", "/api/assistant/runs/" + run.id)).json().status,
  ).toBe("cancelled");
  const f = await readyTask(hub.service);
  expect(
    (await request("GET", `/api/tasks/${f.task.id}/summary`)).json().data,
  ).toBeNull();
  expect((await request("DELETE", "/api/settings/llm")).statusCode).toBe(200);
  expect((await request("GET", "/api/settings/llm")).json().configured).toBe(
    false,
  );
});

async function oauth(scope = "workhub:read workhub:write") {
  const client = (
    await request("POST", "/oauth/register", {
      client_name: "Desktop QA",
      redirect_uris: ["http://localhost:8000/callback"],
      token_endpoint_auth_method: "none",
    })
  ).json();
  const verifier = "v".repeat(43),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const auth = {
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: "http://127.0.0.1:5173/mcp",
    state: "state-test",
    scope,
  };
  return { client, verifier, auth };
}
it("validates OAuth callbacks, resource audience and consent before issuing a code", async () => {
  expect(
    (await request("GET", "/.well-known/oauth-protected-resource/mcp")).json()
      .resource,
  ).toContain("/mcp");
  expect(
    (await request("GET", "/.well-known/oauth-authorization-server")).json()
      .code_challenge_methods_supported,
  ).toEqual(["S256"]);
  expect(
    (
      await request("POST", "/oauth/register", {
        redirect_uris: ["http://evil.example/callback"],
      })
    ).statusCode,
  ).toBe(400);
  const { auth } = await oauth();
  expect(
    (await request("GET", "/oauth/authorize?" + new URLSearchParams(auth)))
      .headers.location,
  ).toContain("/authorize?");
  expect(
    (
      await request("GET", "/api/oauth/request?" + new URLSearchParams(auth))
    ).json().name,
  ).toBe("Desktop QA");
  expect(
    (
      await request("POST", "/api/oauth/authorize", {
        ...auth,
        redirect_uri: "https://evil.example",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("POST", "/api/oauth/authorize", {
        ...auth,
        resource: "https://other.example/mcp",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await request("POST", "/api/oauth/authorize", { ...auth, scope: "admin" }))
      .statusCode,
  ).toBe(400);
});
it("enforces PKCE, one-time codes, refresh rotation, read-only scope and revocation", async () => {
  const { auth, verifier } = await oauth("workhub:read");
  const redirect = new URL(
    (await request("POST", "/api/oauth/authorize", auth)).json().redirect,
  );
  expect(redirect.searchParams.get("state")).toBe("state-test");
  const grant = {
    grant_type: "authorization_code",
    client_id: auth.client_id,
    redirect_uri: auth.redirect_uri,
    code: redirect.searchParams.get("code"),
    code_verifier: verifier,
    resource: auth.resource,
  };
  expect(
    (
      await request("POST", "/oauth/token", {
        ...grant,
        code_verifier: "w".repeat(43),
      })
    ).statusCode,
  ).toBe(400);
  const res = await request("POST", "/oauth/token", grant);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.headers["cache-control"]).toBe("no-store");
  const token = res.json();
  expect(token.scope).toBe("workhub:read");
  expect(
    (
      await request(
        "POST",
        "/api/v1/todos",
        { title: "No write" },
        { authorization: "Bearer " + token.access_token },
      )
    ).statusCode,
  ).toBe(403);
  expect((await request("POST", "/oauth/token", grant)).statusCode).toBe(400);
  const refresh = {
    grant_type: "refresh_token",
    client_id: auth.client_id,
    refresh_token: token.refresh_token,
  };
  const rotated = (await request("POST", "/oauth/token", refresh)).json();
  expect(rotated.scope).toBe("workhub:read");
  expect(
    (
      await request("GET", "/api/bootstrap", undefined, {
        authorization: "Bearer " + token.access_token,
      })
    ).statusCode,
  ).toBe(401);
  expect((await request("POST", "/oauth/token", refresh)).statusCode).toBe(400);
  await db.query("UPDATE tokens SET revoked=true");
  expect(
    (
      await request("POST", "/oauth/token", {
        ...refresh,
        refresh_token: rotated.refresh_token,
      })
    ).statusCode,
  ).toBe(400);
});
it("serves MCP discovery with the same authentication boundary as REST", async () => {
  const contract = (await request("GET", "/api/v1/schema")).json();
  expect(contract.data.result.required).toContain("codeRef");
  expect(contract.serverManagedFields).toContain("principleChecks");
  const noAuth = await hub.app.inject({
    method: "POST",
    url: "/mcp",
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(noAuth.statusCode).toBe(401);
  expect(noAuth.headers["www-authenticate"]).toContain("resource_metadata");
  expect((await request("GET", "/mcp")).statusCode).toBe(405);
  const response = await request(
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { accept: "application/json, text/event-stream" },
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().result.tools.map((t: any) => t.name)).toContain(
    "get_quality_matrix",
  );
  const spec = (await request("GET", "/api/openapi.json")).json();
  expect(spec.openapi).toBe("3.0.3");
  expect(spec.paths["/api/v1/tasks"]).toBeDefined();
});
it("records a principle check through the public owner API with its task version", async () => {
  const f = await readyTask(hub.service);
  const p = await hub.service.create(owner, {
    kind: "principle",
    taskId: f.task.id,
    title: "Stable behavior",
    data: { strength: "required" },
    approve: true,
  });
  await hub.service.adoptPrinciples(owner, f.task.id, 1);
  const res = await request(
    "POST",
    `/api/v1/tasks/${f.task.id}/principle-checks`,
    {
      expectedVersion: 2,
      principleId: p.id,
      note: "Compared implementation and regression evidence",
    },
  );
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().data.data.principleChecks[0].version).toBe(1);
  expect(
    (await request("GET", `/api/v1/tasks/${f.task.id}/completion-check`)).json()
      .data,
  ).toEqual([]);
});
