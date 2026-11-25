import { randomBytes, scrypt as rawScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(rawScrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function normalizeEmail(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
export function validEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function validPassword(value) { return typeof value === "string" && value.length >= 1 && value.length <= 128 && Buffer.byteLength(value) <= 512; }
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("Password must be nonempty and at most 128 characters.");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, options);
  return ["scrypt", salt.toString("hex"), key.toString("hex")].join("$");
}
export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  const valid = parts[0] === "scrypt" && /^[a-f0-9]{32}$/.test(parts[1] || "") && /^[a-f0-9]{128}$/.test(parts[2] || "");
  const salt = Buffer.from(valid ? parts[1] : "00".repeat(16), "hex");
  const expected = Buffer.from(valid ? parts[2] : "00".repeat(64), "hex");
  const key = await scrypt(password, salt, 64, options);
  return timingSafeEqual(key, expected) && valid;
}
