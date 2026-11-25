import pg from "pg";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hashPassword, normalizeEmail, validEmail } from "../lib/server/password.mjs";
const args = process.argv.slice(2);
const reset = args[0] === "--reset";
const email = normalizeEmail(args[reset ? 1 : 0]);
if (!validEmail(email) || args.length !== (reset ? 2 : 1)) throw new Error("Usage: npm run user:create -- parent@example.com (or npm run user:reset -- parent@example.com)");
if (!process.env.DATABASE_ADMIN_URL) throw new Error("Set DATABASE_ADMIN_URL in the administrator task only.");
if (!process.stdin.isTTY) throw new Error("Use an interactive terminal (-it). Passwords are never accepted in command arguments.");
let muted = false;
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
let password;
try {
  process.stdout.write("New parent password (nonempty, hidden): "); muted = true;
  password = await rl.question(""); muted = false; process.stdout.write("\n");
  process.stdout.write("Confirm password (hidden): "); muted = true;
  const confirmation = await rl.question(""); muted = false; process.stdout.write("\n");
  if (password !== confirmation) throw new Error("Passwords do not match.");
} finally { rl.close(); muted = false; }
const hash = await hashPassword(password);
password = undefined;
const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [email]);
  if (reset) {
    const user = (await db.query("UPDATE auth.users SET password_hash=$2 WHERE email=$1 RETURNING id", [email, hash])).rows[0];
    if (!user) throw new Error("Parent account not found.");
    await db.query("DELETE FROM auth.sessions WHERE user_id=$1", [user.id]);
    await db.query("DELETE FROM private.parent_sessions WHERE user_id=$1", [user.id]);
  } else {
    await db.query("INSERT INTO auth.users(email,password_hash) VALUES($1,$2)", [email, hash]);
  }
  await db.query("COMMIT");
  console.log(reset ? "Parent password reset; existing sessions revoked." : "Parent account created. Sign in and choose your family PIN.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
