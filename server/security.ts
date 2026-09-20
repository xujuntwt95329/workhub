import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ensure } from "../shared/domain.js";
const scrypt = promisify(scryptCb);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
export function encrypt(value: string, key: Buffer) {
  ensure(key.length === 32, "CONFIG", "加密主密钥长度错误", 500);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    body.toString("hex"),
  ].join(":");
}
export function decrypt(value: string, key: Buffer) {
  const [iv, tag, body] = value.split(":");
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export function privateAddress(ip: string) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::$|f[cd]|fe[89ab]|::ffff:)/i.test(
    ip,
  );
}
export async function validateEndpoint(
  raw: string,
  allowedOrigins: string[] = [],
) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("无效的模型服务地址");
  }
  ensure(
    !u.username && !u.password && !u.search && !u.hash,
    "INVALID_URL",
    "模型地址不能包含凭证、查询参数或片段",
  );
  if (allowedOrigins.includes(u.origin)) return u;
  ensure(u.protocol === "https:", "INVALID_URL", "模型服务必须使用 HTTPS");
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  ensure(
    addresses.length > 0 && addresses.every((a) => !privateAddress(a.address)),
    "PRIVATE_ENDPOINT",
    "私有模型地址需要在部署白名单中显式配置",
  );
  return u;
}
export function safeRedirect(raw: string) {
  try {
    const u = new URL(raw);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
