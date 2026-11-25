import type { NextRequest } from "next/server";
import { clearCookie, digest, sessionToken } from "@/lib/server/auth";
import { pool } from "@/lib/server/db";
import { failure, json, readBody } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { await readBody(request); const token = sessionToken(request); if (token) await pool().query("SELECT auth.logout_session($1)", [digest(token)]); const response = json({ ok: true }); clearCookie(response); return response; }
  catch (error) { return failure(error); }
}
