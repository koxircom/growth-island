import type { NextRequest } from "next/server";
import { sessionUser, sessionToken, digest } from "@/lib/server/auth";
import { transaction } from "@/lib/server/db";
import { failure, HttpError, json, readBody } from "@/lib/server/http";
export const runtime = "nodejs";
// POST keeps the capability out of URLs/logs. This handler only reads data.
export async function POST(request: NextRequest) {
 try {
  const body = await readBody(request);
  if (typeof body.parent_token !== "string" || !/^[a-f0-9]{64}$/.test(body.parent_token)) throw new HttpError(403,"parent_required");
  const data = await transaction(async client => {
   const user = await sessionUser(request,client);
   if (!user) throw new HttpError(401,"authentication_required");
   await client.query("SET LOCAL ROLE authenticated");
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
   await client.query("SELECT set_config('request.session_hash',$1,true)",[digest(sessionToken(request)!)]);
   return (await client.query("SELECT public.get_switch_operations($1) AS result",[body.parent_token])).rows[0].result;
  });
  return json({data});
 } catch(error) {
  if ((error as Error).message==="parent_required") return json({error:"parent_required"},403);
  return failure(error);
 }
}
