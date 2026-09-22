import { it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { posix } from "node:path";
import { buildCodexPlugin } from "../server/codex-plugin";
import { buildClaudePlugin } from "../server/claude-plugin";
import { pluginSkills } from "../shared/claude-plugin";
import { codexMcpCommand } from "../shared/codex-plugin";
import { recordContract } from "../server/contract";

const input = {
  target: "codex",
  authentication: "oauth",
  baseUrl: "https://hub.example",
} as const;
const unpack = (buffer: Uint8Array) =>
  Object.fromEntries(
    Object.entries(unzipSync(buffer)).map(([p, b]) => [p, strFromU8(b)]),
  );

it.each(["oauth", "token"])(
  "packages a complete Codex %s plugin and standalone compatibility skills",
  (authentication) => {
    const { buffer, filename } = buildCodexPlugin({ ...input, authentication });
    const files = unpack(buffer);
    const prefix = "workhub-codex/plugins/workhub/";
    expect(filename).toMatch(/^workhub-codex-[\d.]+\.zip$/);
    const manifest = JSON.parse(files[prefix + ".codex-plugin/plugin.json"]);
    expect(manifest).toMatchObject({
      name: "workhub",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      interface: { displayName: "WorkHub" },
    });
    expect(files[prefix + manifest.mcpServers.slice(2)]).toBeDefined();
    expect(JSON.parse(files[prefix + ".mcp.json"])).toEqual({
      mcpServers: {
        workhub: {
          type: "http",
          url: "https://hub.example/mcp",
          ...(authentication === "token"
            ? { bearer_token_env_var: "WORKHUB_TOKEN" }
            : {}),
        },
      },
    });
    expect(JSON.parse(files[prefix + "references/record-schema.json"])).toEqual(
      recordContract,
    );
    const marketplace = JSON.parse(
      files["workhub-codex/.agents/plugins/marketplace.json"],
    );
    expect(marketplace).toMatchObject({
      name: "workhub-codex-local",
      plugins: [
        {
          name: "workhub",
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    });
    expect(
      files[
        posix.join(
          "workhub-codex",
          marketplace.plugins[0].source.path,
          ".codex-plugin/plugin.json",
        )
      ],
    ).toBeDefined();
    const claude = unpack(
      buildClaudePlugin({ ...input, target: "code" }).buffer,
    );
    for (const skill of pluginSkills) {
      const native = `skills/${skill.name}/SKILL.md`;
      expect(files[prefix + native]).toBe(
        claude["workhub-marketplace/plugins/workhub/" + native],
      );
      const compatibility = `workhub-codex/compat/skills/workhub-${skill.name}/`;
      expect(files[compatibility + "SKILL.md"]).toContain(
        `name: workhub-${skill.name}`,
      );
      expect(
        JSON.parse(files[compatibility + "references/record-schema.json"]),
      ).toEqual(recordContract);
    }
    for (const [path, text] of Object.entries(files).filter(([p]) =>
      p.endsWith(".md"),
    ))
      for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
        if (link.startsWith("https:")) continue;
        expect(
          files[posix.normalize(posix.join(posix.dirname(path), link))],
          `${path}: ${link}`,
        ).toBeDefined();
      }
    expect(
      Object.keys(files).every(
        (p) => !p.includes("..") && !p.startsWith("/") && !p.includes("\\"),
      ),
    ).toBe(true);
    expect(
      Object.keys(files).some((p) =>
        /\.claude-plugin|\.env|\.data|hooks|node_modules|credentials|master\.key/.test(
          p,
        ),
      ),
    ).toBe(false);
    const readme = files["workhub-codex/README.md"];
    expect(readme).toContain("codex plugin marketplace add ./workhub-codex");
    expect(readme).toContain("codex plugin add workhub@workhub-codex-local");
    expect(readme).toContain(
      "codex mcp add workhub --url 'https://hub.example/mcp'",
    );
    expect(readme).toContain(
      authentication === "token"
        ? "--bearer-token-env-var WORKHUB_TOKEN"
        : "codex mcp login workhub",
    );
    expect(readme).not.toContain("claude plugin");
  },
);

it("generates reproducible archives while changing configuration changes the archive", () => {
  const a = buildCodexPlugin(input);
  const b = buildCodexPlugin({ ...input, baseUrl: " https://hub.example/ " });
  expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(a.buffer).toEqual(b.buffer);
  expect(a.sha256).toBe(b.sha256);
  expect(
    buildCodexPlugin({ ...input, authentication: "token" }).sha256,
  ).not.toBe(a.sha256);
  expect(
    buildCodexPlugin({ ...input, baseUrl: "https://another.example" }).sha256,
  ).not.toBe(a.sha256);
  expect(codexMcpCommand(input)).toBe(
    "codex mcp add workhub --url 'https://hub.example/mcp'",
  );
});

it.each([
  { baseUrl: "invalid" },
  { baseUrl: "http://hub.example" },
  { baseUrl: "https://user:secret@hub.example" },
  { baseUrl: "https://hub.example/?token=secret" },
  { baseUrl: "https://hub.example/#secret" },
  { baseUrl: "https://hub.example/mcp" },
  { baseUrl: "https://host'quote.example" },
  { baseUrl: "https://host`whoami`.example" },
  { target: "code" },
  { target: "desktop" },
  { token: "SHOULD-NEVER-BE-PACKAGED" },
  { authentication: "none" },
])("rejects unsupported or unsafe Codex download input %j", (patch) => {
  expect(() => buildCodexPlugin({ ...input, ...patch })).toThrow();
});

it.each([
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://[::1]:3001",
  "https://192.168.1.10",
])("supports local Codex origins %s", (baseUrl) => {
  expect(buildCodexPlugin({ ...input, baseUrl }).buffer.length).toBeGreaterThan(
    0,
  );
});

it("does not accept a Codex target at the Claude packaging entry", () => {
  expect(() => buildClaudePlugin(input)).toThrow("Claude");
});
