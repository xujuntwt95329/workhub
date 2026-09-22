import { beforeAll, afterAll, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { posix } from "node:path";
import { buildClaudePlugin } from "../server/claude-plugin";
import { buildCodexPlugin } from "../server/codex-plugin";
import { pluginDownloadSchema, pluginSkills } from "../shared/claude-plugin";
import { recordContract } from "../server/contract";
import { openDatabase, type Database } from "../server/db";
import { buildApp } from "../server/app";
import { createAgentToken } from "../server/auth";
import { clear } from "./fixtures";

const input = {
  target: "code",
  authentication: "oauth",
  baseUrl: "https://hub.example",
};
const unpack = (buffer: Uint8Array) =>
  Object.fromEntries(
    Object.entries(unzipSync(buffer)).map(([path, content]) => [
      path,
      strFromU8(content),
    ]),
  );

it.each(["code", "desktop"])(
  "packages a complete %s plugin with valid internal references and current contract",
  (target) => {
    const { buffer, filename, sha256 } = buildClaudePlugin({
      ...input,
      target,
    });
    const files = unpack(buffer);
    const prefix =
      target === "code" ? "workhub-marketplace/plugins/workhub/" : "";
    expect(filename).toMatch(
      new RegExp(`^workhub-claude-${target}-[\\d.]+\\.zip$`),
    );
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(files[prefix + ".claude-plugin/plugin.json"]).name).toBe(
      "workhub",
    );
    expect(JSON.parse(files[prefix + ".mcp.json"])).toEqual({
      mcpServers: { workhub: { type: "http", url: "https://hub.example/mcp" } },
    });
    expect(JSON.parse(files[prefix + "references/record-schema.json"])).toEqual(
      recordContract,
    );
    expect(files[prefix + "README.md"]).toContain(
      target === "code"
        ? "claude plugin install workhub@workhub-local --scope user"
        : "Customize → Plugins",
    );
    for (const skill of pluginSkills) {
      const path = prefix + `skills/${skill.name}/SKILL.md`;
      const text = files[path];
      expect(text).toMatch(
        new RegExp(`^---\\r?\\nname: ${skill.name}\\r?\\ndescription: .+`),
      );
      for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
        expect(
          files[posix.normalize(posix.join(posix.dirname(path), link))],
          `${skill.name}: broken ${link}`,
        ).toBeDefined();
      }
    }
    if (target === "code") {
      const marketplace = JSON.parse(
        files["workhub-marketplace/.claude-plugin/marketplace.json"],
      );
      expect(marketplace.name).toBe("workhub-local");
      expect(
        files[
          posix.join(
            "workhub-marketplace",
            marketplace.plugins[0].source,
            ".claude-plugin/plugin.json",
          )
        ],
      ).toBeDefined();
    }
    expect(Object.keys(files)).toHaveLength(target === "code" ? 15 : 13);
    expect(
      Object.keys(files).every(
        (p) => !p.includes("..") && !p.startsWith("/") && !p.includes("\\"),
      ),
    ).toBe(true);
    expect(
      Object.keys(files).some((p) =>
        /\.env|\.data|hooks|node_modules|credentials|master\.key/.test(p),
      ),
    ).toBe(false);
  },
);

it("creates deterministic archives, normalizes the origin and uses a literal token environment reference", () => {
  const one = buildClaudePlugin({
    ...input,
    authentication: "token",
    baseUrl: "  https://hub.example/  ",
  });
  const two = buildClaudePlugin({ ...input, authentication: "token" });
  expect(one.sha256).toBe(two.sha256);
  expect(one.buffer).toEqual(two.buffer);
  const files = unpack(one.buffer);
  const mcp = JSON.parse(
    files["workhub-marketplace/plugins/workhub/.mcp.json"],
  );
  expect(mcp.mcpServers.workhub.headers.Authorization).toBe(
    "Bearer ${WORKHUB_TOKEN}",
  );
  expect(files["workhub-marketplace/README.md"]).toContain("Read-Host");
  expect(files["workhub-marketplace/README.md"]).toContain("read -rsp");
});

it.each([
  { baseUrl: "not a URL" },
  { baseUrl: "http://hub.example" },
  { baseUrl: "ftp://hub.example" },
  { baseUrl: "https://user:secret@hub.example" },
  { baseUrl: "https://hub.example/?token=secret" },
  { baseUrl: "https://hub.example/#secret" },
  { baseUrl: "https://hub.example/subpath" },
  { baseUrl: "https://hub.example/\n" + "path" },
  { baseUrl: "https://hub.example\\" },
  { target: "desktop", baseUrl: "http://127.0.0.1:5173" },
  { target: "desktop", baseUrl: "https://localhost" },
  { target: "desktop", authentication: "token" },
  { target: "unknown" },
  { token: "NEVER-INCLUDE-MY-SECRET" },
])("rejects unsafe or unsupported download input: %j", (patch) => {
  expect(() => buildClaudePlugin({ ...input, ...patch })).toThrow();
});

it.each([
  "http://localhost:5173",
  "http://127.0.0.1:3001",
  "http://[::1]:3001",
])("supports Code on loopback %s", (baseUrl) => {
  expect(pluginDownloadSchema.safeParse({ ...input, baseUrl }).success).toBe(
    true,
  );
});

let db: Database, hub: Awaited<ReturnType<typeof buildApp>>, cookie: string;
beforeAll(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL);
  await clear(db);
  hub = await buildApp(db, {
    publicUrl: "http://127.0.0.1:5173",
    production: false,
    encryptionKey: Buffer.alloc(32, 4),
  });
  const response = await hub.app.inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: { name: "Plugin owner", password: "plugin-owner-password" },
  });
  expect(response.statusCode, response.body).toBe(200);
  cookie = response.headers["set-cookie"]!.toString().split(";")[0];
});
afterAll(async () => {
  await hub.app.close();
  await db.close();
});

it.each(["claude", "codex"])(
  "requires owner authentication for %s metadata and download, including write-enabled agents",
  async (client) => {
    const { token } = await createAgentToken(
      db,
      "Plugin agent",
      ["*"],
      ["read", "write"],
    );
    for (const method of ["GET", "POST"] as const) {
      const url =
        "/api/plugins/" + client + (method === "POST" ? "/download" : "");
      const payload =
        method === "POST"
          ? { ...input, target: client === "codex" ? "codex" : "code" }
          : undefined;
      expect((await hub.app.inject({ method, url, payload })).statusCode).toBe(
        401,
      );
      expect(
        (
          await hub.app.inject({
            method,
            url,
            payload,
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(403);
    }
  },
);

it.each(["claude", "codex"])(
  "returns configured URL instead of untrusted Host and excludes credentials from %s ZIPs",
  async (client) => {
    const headers = { cookie, host: "untrusted.example" };
    const metadata = await hub.app.inject({
      method: "GET",
      url: "/api/plugins/" + client,
      headers,
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({
      publicUrl: "http://127.0.0.1:5173",
      skills: pluginSkills,
    });
    const token = await createAgentToken(db, "Private token", ["*"], ["write"]);
    const response = await hub.app.inject({
      method: "POST",
      url: "/api/plugins/" + client + "/download",
      headers,
      payload: { ...input, target: client === "codex" ? "codex" : "code" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    const artifact =
      client === "codex"
        ? buildCodexPlugin({ ...input, target: "codex" })
        : buildClaudePlugin(input);
    expect(response.rawPayload).toEqual(artifact.buffer);
    expect(response.headers["x-content-sha256"]).toBe(artifact.sha256);
    const allText = Object.values(unpack(response.rawPayload)).join("\n");
    expect(allText).not.toContain(token.token);
    expect(allText).not.toContain("plugin-owner-password");
    expect(allText).not.toContain("Plugin owner");
  },
);

it.each(["claude", "codex"])(
  "returns actionable validation errors and rejects cross-origin %s generation",
  async (client) => {
    const invalid = await hub.app.inject({
      method: "POST",
      url: "/api/plugins/" + client + "/download",
      headers: { cookie },
      payload: { ...input, target: "desktop", authentication: "token" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.message).toContain("OAuth");
    const foreign = await hub.app.inject({
      method: "POST",
      url: "/api/plugins/" + client + "/download",
      headers: { cookie, origin: "https://foreign.example" },
      payload: input,
    });
    expect(foreign.statusCode).toBe(403);
  },
);
