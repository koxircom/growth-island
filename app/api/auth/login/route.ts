import type { NextRequest } from "next/server";
import { login, setCookie } from "@/lib/server/auth";
import { failure, json, readBody } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { const session = await login(await readBody(request)); const response = json({ session: { user: session.user } }); setCookie(response, session.token); return response; }
  catch (error) { return failure(error); }
}
