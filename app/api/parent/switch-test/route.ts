// Candidate for formal app /api/parent/switch-test/route.ts, not test app.
// Existing readBody enforces exact APP_ORIGIN, JSON, bounded body and no cross-site.
import type { NextRequest } from "next/server";
import { sessionUser, sessionToken, digest } from "@/lib/server/auth";
import { transaction } from "@/lib/server/db";
import { failure, HttpError, json, readBody } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
 try {
  const body = await readBody(request);
  if (Object.keys(body).length !== 1 || typeof body.parent_token !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.parent_token)) throw new HttpError(400,"invalid_request");
  if (!sessionToken(request)) throw new HttpError(401,"authentication_required");
  const data = await transaction(async client => {
   const user = await sessionUser(request,client);
   if (!user) throw new HttpError(401,"authentication_required");
   await client.query("SET LOCAL ROLE authenticated");
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
   await client.query("SELECT set_config('request.session_hash',$1,true)",[digest(sessionToken(request)!)]);
   return (await client.query("SELECT public.request_switch_test($1) AS result",[body.parent_token])).rows[0].result;
  });
  return json({data},202); // Accepted/observed is NOT device success.
 } catch(error) { return failure(error); }
}
