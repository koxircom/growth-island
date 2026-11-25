import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { pool, transaction } from "./db";
import { isChildLanHost } from "./child-lan-host";
import { appOrigin, HttpError } from "./http";
import { normalizeEmail, validEmail, verifyPassword } from "./password.mjs";
const maxAge = 30 * 86400;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function cookieOptions() {
  const secure = appOrigin().startsWith("https:");
  return { name: secure ? "__Host-growth_session" : "growth_session", secure, httpOnly: true, sameSite: "lax" as const, path: "/", maxAge };
}
export function sessionToken(request: NextRequest) {
  const token = request.cookies.get(cookieOptions().name)?.value || "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function sessionUser(request: NextRequest, client?: PoolClient) {
  const token = sessionToken(request);
  if (!token) return null;
  const result = await (client || pool()).query(
    "SELECT u.id,u.email FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()" + (client ? " FOR SHARE OF s" : ""), [digest(token)],
  );
  return result.rows[0] || null;
}
export function setCookie(response: NextResponse, token: string) { response.cookies.set({ ...cookieOptions(), value: token }); }
export function clearCookie(response: NextResponse) { response.cookies.set({ ...cookieOptions(), value: "", maxAge: 0 }); }
export async function login(body: Record<string, unknown>) {
  const owner = (await pool().query("SELECT u.email,h.login_lockout_enabled FROM auth.household_login h JOIN auth.users u ON u.id=h.user_id WHERE h.singleton")).rows[0];
  const email = owner?.email || "";
  if (!owner) throw new HttpError(409, "setup_required");
  const password = body.password;
  if (!validEmail(email) || typeof password !== "string" || !password.length || password.length > 128 || Buffer.byteLength(password) > 512)
    throw new HttpError(401, "invalid_credentials");
  const result = await transaction(async client => {
    const keys = [digest("global-login"), digest("account:" + email)];
    // Limits survive process restarts and multiple app instances. No trusted-proxy/IP assumption.
    for (let index = 0; owner.login_lockout_enabled && index < keys.length; index++) {
      await client.query("INSERT INTO auth.login_attempts(key_hash,attempts) VALUES($1,0) ON CONFLICT DO NOTHING", [keys[index]]);
      const rate = (await client.query("SELECT attempts,window_start < now()-interval '10 minutes' AS expired FROM auth.login_attempts WHERE key_hash=$1 FOR UPDATE", [keys[index]])).rows[0];
      if (!rate.expired && rate.attempts >= (index === 0 ? 100 : 5)) return { blocked: true };
      await client.query("UPDATE auth.login_attempts SET attempts=CASE WHEN window_start < now()-interval '10 minutes' THEN 1 ELSE attempts+1 END, window_start=CASE WHEN window_start < now()-interval '10 minutes' THEN now() ELSE window_start END WHERE key_hash=$1", [keys[index]]);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [email]);
    const user = (await client.query("SELECT id,email,password_hash FROM auth.users WHERE email=$1", [email])).rows[0];
    const valid = await verifyPassword(password, user?.password_hash);
    if (!valid || !user) return { invalid: true };
    const token = randomBytes(32).toString("hex");
    await client.query("DELETE FROM auth.sessions WHERE expires_at<=now()");
    await client.query("DELETE FROM auth.login_attempts WHERE window_start < now()-interval '1 day'");
    await client.query("DELETE FROM auth.login_attempts WHERE key_hash=$1", [keys[1]]);
    await client.query("INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [digest(token), user.id]);
    return { token, credentialHash: user.password_hash as string, user: { id: user.id as string, email: user.email as string } };
  });
  if ("blocked" in result) throw new HttpError(429, "login_rate_limited");
  if ("invalid" in result) throw new HttpError(401, "invalid_credentials");
  return result;
}

// Anonymous requests may identify only the configured household for child-facing APIs.
// This does not create an auth session or grant a parent capability.
export async function childViewer(request: NextRequest, client?: PoolClient) {
 const signed=await sessionUser(request,client);
 if(signed)return {...signed,visitor:false};
 if(!isChildLanHost(appOrigin(),process.env.CHILD_LAN_HOSTNAME||""))return null;
 const r=await (client||pool()).query("SELECT auth.child_household_owner() AS id");
 return r.rows[0]?.id?{...r.rows[0],email:"",visitor:true}:null;
}
