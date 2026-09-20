import { it, expect, vi } from "vitest";
import {
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
  digest,
  randomToken,
  privateAddress,
  validateEndpoint,
  safeRedirect,
} from "../server/security";
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) =>
    host === "private.example"
      ? [{ address: "10.0.0.1" }]
      : host === "empty.example"
        ? []
        : [{ address: "8.8.8.8" }],
  ),
}));
it("salts and verifies passwords without accepting malformed hashes", async () => {
  const a = await hashPassword("correct horse battery");
  expect(a).not.toBe(await hashPassword("correct horse battery"));
  expect(await verifyPassword("correct horse battery", a)).toBe(true);
  expect(await verifyPassword("wrong", a)).toBe(false);
  expect(await verifyPassword("wrong", "malformed")).toBe(false);
  expect(await verifyPassword("wrong", "salt:" + "z".repeat(128))).toBe(false);
});
it("authenticates ciphertext and never repeats IVs", () => {
  const key = Buffer.alloc(32, 1),
    encrypted = encrypt("secret", key);
  expect(encrypted).not.toContain("secret");
  expect(encrypt("secret", key)).not.toBe(encrypted);
  expect(decrypt(encrypted, key)).toBe("secret");
  expect(() => decrypt(encrypted, Buffer.alloc(32, 2))).toThrow();
  expect(() => encrypt("x", Buffer.alloc(3))).toThrow();
  expect(digest("x")).toHaveLength(64);
  expect(randomToken()).not.toBe(randomToken());
});
it.each([
  "127.0.0.1",
  "10.4.0.1",
  "192.168.2.2",
  "172.16.0.1",
  "172.31.1.1",
  "169.254.169.254",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
])("rejects private endpoint %s", (ip) =>
  expect(privateAddress(ip)).toBe(true),
);
it.each(["8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])(
  "allows public address %s",
  (ip) => expect(privateAddress(ip)).toBe(false),
);
it("validates endpoint syntax, scheme, DNS and explicit local opt-in", async () => {
  await expect(validateEndpoint("not a URL")).rejects.toThrow();
  for (const raw of [
    "https://user:pass@public.example/v1",
    "https://public.example/v1?q=1",
    "https://public.example/#x",
    "http://public.example",
    "https://127.0.0.1",
    "https://private.example",
    "https://empty.example",
  ])
    await expect(validateEndpoint(raw)).rejects.toThrow();
  expect((await validateEndpoint("https://public.example/v1")).pathname).toBe(
    "/v1",
  );
  expect(
    (
      await validateEndpoint("http://127.0.0.1:11434/v1", [
        "http://127.0.0.1:11434",
      ])
    ).hostname,
  ).toBe("127.0.0.1");
});
it.each([
  ["https://client.example/callback", true],
  ["http://localhost:4000/callback", true],
  ["http://[::1]:4000", true],
  ["http://evil.example", false],
  ["javascript:alert(1)", false],
  ["https://a:b@client.example", false],
  ["https://client.example/#fragment", false],
  ["bad", false],
])("redirect %s is safe=%s", (raw, expected) =>
  expect(safeRedirect(String(raw))).toBe(expected),
);
