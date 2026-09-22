import { readFileSync } from "node:fs";
import { pluginSkills } from "../shared/claude-plugin.js";

// Both clients use the same reviewed skills and protocol; keep one source of truth.
const root = new URL("../plugins/claude/workhub/", import.meta.url);
const paths = [
  ...pluginSkills.map((s) => `skills/${s.name}/SKILL.md`),
  "references/protocol.md",
  "references/quality-evidence.md",
];
// Explicit allowlist: never collect workspace records, credentials or local config.
export const engineeringAssets = Object.fromEntries(
  paths.map((path) => [path, readFileSync(new URL(path, root), "utf8")]),
);
