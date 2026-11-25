import type { NextRequest } from "next/server";
import { childViewer } from "@/lib/server/auth";
import { failure, json } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { const user = await childViewer(request); return json({ session: user ? { user } : null }); }
  catch (error) { return failure(error); }
}
