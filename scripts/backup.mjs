import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve, dirname } from "node:path";
const target = resolve(
  process.argv[2] ??
    `backups/workhub-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
);
await mkdir(dirname(target), { recursive: true });
const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
// Binary streaming is safe on both PowerShell and Unix; shell redirection is not used.
const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "pg_dump",
    "-U",
    "workhub",
    "-d",
    "workhub",
    "-Fc",
  ],
  { stdio: ["ignore", "pipe", "inherit"], shell: false },
);
const exited = new Promise((yes, no) => {
  child.on("error", no);
  child.on("exit", (code) =>
    code === 0 ? yes() : no(new Error("pg_dump exited " + code)),
  );
});
await Promise.all([pipeline(child.stdout, output), exited]);
console.log(
  `Saved ${target} (${(await stat(target)).size} bytes). Keep KEY_ENCRYPTION_KEY in a separate protected backup.`,
);
