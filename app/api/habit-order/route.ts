import type {NextRequest} from "next/server";
import {childViewer} from "@/lib/server/auth";
import {transaction} from "@/lib/server/db";
import {failure,HttpError,json,readBody} from "@/lib/server/http";
export const runtime="nodejs";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request);
  if(typeof body.child_id!=="string"||!uuid.test(body.child_id)||!["read","save"].includes(String(body.action)))throw new HttpError(400,"invalid_request");
  if(body.action==="save"&&(typeof body.request_id!=="string"||!uuid.test(body.request_id)||
    !["routine","occasional"].includes(String(body.category))||typeof body.token!=="string"||!/^[a-f0-9]{32}$/.test(body.token)||
    !Array.isArray(body.ids)||body.ids.length<2||body.ids.length>300||body.ids.some(id=>typeof id!=="string"||!uuid.test(id))))throw new HttpError(400,"invalid_request");
  const data=await transaction(async client=>{
   const user=await childViewer(request,client);
   if(!user)throw new HttpError(401,"authentication_required");
   await client.query("SET LOCAL ROLE authenticated");
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
   if(body.action==="read")return (await client.query("SELECT public.habit_order_read($1::uuid) result",[body.child_id])).rows[0].result;
   return (await client.query("SELECT public.habit_order_save($1::jsonb,$2::uuid) result",[
    JSON.stringify({child_id:body.child_id,category:body.category,ids:body.ids,token:body.token}),body.request_id])).rows[0].result;
  });
  return json({data});
 }catch(error){
  const e=error as {code?:string;message?:string};
  if(e.code==="P0001"&&e.message==="habit_order_conflict")return json({error:e.message},409);
  if(e.code==="P0001"&&["authentication_required","family_not_found","child_not_found","invalid_request","idempotency_conflict"].includes(e.message||""))return json({error:e.message},400);
  if(["22P02","23514","23502"].includes(e.code||""))return json({error:"invalid_request"},400);
  return failure(error);
 }
}
