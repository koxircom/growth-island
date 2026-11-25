import { pool } from "@/lib/server/db";
import { appOrigin, json } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { appOrigin(); await pool().query("SELECT 1"); return json({ ok: true }); }
  catch { return json({ ok: false }, 503); }
}
