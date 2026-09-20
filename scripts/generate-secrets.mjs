import { randomBytes } from "node:crypto";
console.log("KEY_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"));
console.log("SETUP_TOKEN=" + randomBytes(32).toString("base64url"));
console.log("POSTGRES_PASSWORD=" + randomBytes(32).toString("base64url"));
