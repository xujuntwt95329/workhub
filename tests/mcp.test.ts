import { beforeAll, afterAll, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDatabase, type Database } from "../server/db";
import { Service, owner } from "../server/service";
import { createMcpServer } from "../server/mcp";
import { agent, readyTask, clear } from "./fixtures";
import { readFileSync } from "node:fs";
let db: Database, s: Service;
beforeAll(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL);
  await clear(db);
  s = new Service(db);
});
afterAll(async () => db.close());
it("replays the shipped quality skill example with exact versions, idempotency and stale evidence rejection", async () => {
  const fixture = await readyTask(s);
  const example = readFileSync(
    new URL(
      "../plugins/claude/workhub/references/quality-evidence.md",
      import.meta.url,
    ),
    "utf8",
  ).match(/```json\s+([\s\S]*?)```/)![1];
  const input = JSON.parse(example);
  input.taskId = fixture.task.id;
  input.title = "Plugin contract test fixture (not a real engineering run)";
  input.data = {
    ...input.data,
    checkId: fixture.check.id,
    checkVersion: fixture.check.version,
    criterionVersions: { [fixture.criterion.id]: fixture.criterion.version },
    requirementVersions: {
      [fixture.requirement.id]: fixture.requirement.version,
    },
    codeRef: fixture.task.data.codeRef,
    outcome: "failed",
    evidence: "Synthetic protocol fixture",
  };
  input.idempotencyKey = "plugin-contract-execution";
  const server = createMcpServer(s, agent([fixture.task.id]));
  const client = new Client({ name: "plugin-contract-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const call = async (name: string, args: any) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const recorded = await call("create_record", input);
    expect((await call("create_record", input)).id).toBe(recorded.id);
    expect(
      (await call("get_quality_matrix", { taskId: fixture.task.id })).metrics
        .passed,
    ).toBe(0);
    await call("update_record", {
      id: fixture.requirement.id,
      expectedVersion: fixture.requirement.version,
      body: "Changed behavior",
      idempotencyKey: "plugin-contract-change",
    });
    const stale = await client.callTool({
      name: "create_record",
      arguments: { ...input, idempotencyKey: "plugin-contract-stale" },
    });
    expect(stale.isError).toBe(true);
    expect((stale.content as { text: string }[])[0].text).toContain("需求版本");
    const context = await call("get_task_context", { taskId: fixture.task.id });
    expect(
      context.records.find(
        (r: { id: string }) => r.id === fixture.requirement.id,
      ).version,
    ).toBe(fixture.requirement.version + 1);
  } finally {
    await client.close();
    await server.close();
    await clear(db);
  }
});
it("executes every MCP tool through the official protocol with version and scope enforcement", async () => {
  const f = await readyTask(s);
  const server = createMcpServer(s, agent());
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const call = async (name: string, args: any) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    expect((await client.listTools()).tools).toHaveLength(10);
    const starred = await call("set_record_star", {
      id: f.requirement.id,
      starred: true,
      idempotencyKey: "mcp-star",
    });
    expect(starred).toEqual({ ...f.requirement, starred: true });
    expect(
      await call("list_records", { starred: true, taskId: f.task.id }),
    ).toEqual([starred]);
    expect(
      (await call("list_records", { starred: false })).every(
        (r: any) => !r.starred,
      ),
    ).toBe(true);
    const schema = await client.readResource({ uri: "workhub://schema" });
    const schemaContent = schema.contents[0];
    expect(
      JSON.parse("text" in schemaContent ? schemaContent.text : "{}").version,
    ).toBe(2);
    expect(
      (await client.readResource({ uri: "workhub://guide" })).contents[0],
    ).toHaveProperty("text");
    expect(
      (await call("get_task_context", { taskId: f.task.id })).task.id,
    ).toBe(f.task.id);
    expect(
      (await call("get_quality_matrix", { taskId: f.task.id })).metrics.passed,
    ).toBe(1);
    expect(await call("list_records", { kind: "task" })).toHaveLength(1);
    const todo = await call("create_record", {
      kind: "todo",
      title: "MCP idea",
      idempotencyKey: "mcp-create",
    });
    const assigned = await call("assign_todo_to_task", {
      id: todo.id,
      expectedVersion: 1,
      taskId: f.task.id,
      idempotencyKey: "mcp-assign",
    });
    expect(assigned.taskId).toBe(f.task.id);
    await call("assign_todo_to_task", {
      id: todo.id,
      expectedVersion: 2,
      taskId: null,
      idempotencyKey: "mcp-unassign",
    });
    const edited = await call("update_record", {
      id: todo.id,
      expectedVersion: 3,
      body: "More detail",
      idempotencyKey: "mcp-update",
    });
    expect(edited.version).toBe(4);
    const conflict = await client.callTool({
      name: "update_record",
      arguments: {
        id: todo.id,
        expectedVersion: 1,
        title: "stale",
        idempotencyKey: "mcp-conflict",
      },
    });
    expect(conflict.isError).toBe(true);
    expect(
      (
        await call("transition_record", {
          id: todo.id,
          expectedVersion: 4,
          status: "planned",
          idempotencyKey: "mcp-transition",
        })
      ).status,
    ).toBe("planned");
    expect(
      (
        await call("convert_todo_to_task", {
          id: todo.id,
          expectedVersion: 5,
          projectId: f.project.id,
          idempotencyKey: "mcp-convert",
        })
      ).kind,
    ).toBe("task");
    expect(
      (
        await call("request_review", {
          id: f.check.id,
          expectedVersion: 1,
          idempotencyKey: "mcp-review",
        })
      ).id,
    ).toBeTruthy();
  } finally {
    await client.close();
    await server.close();
  }
});
