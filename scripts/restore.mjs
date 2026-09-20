import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
if (!process.argv[2] || process.argv[3] !== "--confirm-replace")
  throw new Error(
    "Usage: node scripts/restore.mjs backup.dump --confirm-replace (replaces current database contents)",
  );
const source = resolve(process.argv[2]);
await stat(source);
async function run(args) {
  const child = spawn("docker", ["compose", ...args], {
    stdio: "inherit",
    shell: false,
  });
  await new Promise((yes, no) => {
    child.on("error", no);
    child.on("exit", (code) =>
      code === 0 ? yes() : no(new Error("docker compose exited " + code)),
    );
  });
}
await run(["stop", "app"]);
const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "pg_restore",
    "-U",
    "workhub",
    "-d",
    "workhub",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--exit-on-error",
    "--single-transaction",
  ],
  { stdio: ["pipe", "inherit", "inherit"], shell: false },
);
const exited = new Promise((yes, no) => {
  child.on("error", no);
  child.on("exit", (code) =>
    code === 0
      ? yes()
      : no(
          new Error(
            "Restore failed; app remains stopped. Inspect the error before restarting.",
          ),
        ),
  );
});
await Promise.all([pipeline(createReadStream(source), child.stdin), exited]);
await run(["up", "-d", "app"]);
console.log(
  "Restored. Use the KEY_ENCRYPTION_KEY that belongs to this backup.",
);
