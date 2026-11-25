import type {NextRequest} from "next/server";
import {childViewer,sessionToken,digest,clearCookie} from "@/lib/server/auth";
import {transaction} from "@/lib/server/db";
import {readBody,json,failure,HttpError,appOrigin} from "@/lib/server/http";
import {childBrowser,setChildContext,setChildCookie} from "@/lib/server/child-access";
import {encryptChildPassword,decryptChildPassword} from "@/lib/server/child-password-crypto";
export const runtime="nodejs";
const actions=new Set(["status","enroll","setup","unlock","lock","view","change"]);
const business=new Set(["parent_required","child_not_found","child_unlock_required","child_password_already_set","child_password_not_set","invalid_child_password"]);
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request);const action=String(body.action||"");
  if(!actions.has(action))throw new HttpError(400,"invalid_request");
  const origin=new URL(appOrigin());
  if(!["status","lock"].includes(action)&&origin.protocol!=="https:"&&!["localhost","127.0.0.1","[::1]"].includes(origin.hostname))throw new HttpError(403,"child_password_https_required");
  const child=typeof body.child_id==="string"?body.child_id.toLowerCase():"";
  if(!["status","lock"].includes(action)&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(child))throw new HttpError(400,"invalid_request");
  const password=body.password;
  if(["setup","change","unlock"].includes(action)&&(typeof password!=="string"||password.length<4||password.length>32||Buffer.byteLength(password)>72))throw new HttpError(400,"invalid_child_password");
  if(body.pin_format===true&&(action!=="change"||typeof password!=="string"||!/^\d{6}$/.test(password)))throw new HttpError(400,"invalid_child_password");
  const token=childBrowser(request,true);
  const result=await transaction(async client=>{
   const user=await childViewer(request,client);if(!user)throw new HttpError(401,"authentication_required");
   await client.query("SET LOCAL ROLE authenticated");
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
   await client.query("SELECT set_config('request.session_hash',$1,true)",[user.visitor?"":digest(sessionToken(request)!)]);
   await setChildContext(client,request,token);
   const payload:Record<string,unknown>={child_id:child};
   if(typeof password==="string")payload.password=password;
   if(["setup","change"].includes(action))payload.password_cipher=encryptChildPassword(child,password as string);
   const r=(await client.query("SELECT public.child_access($1,$2::jsonb,$3) result",[action,JSON.stringify(payload),user.visitor?null:body.parent_token||null])).rows[0].result;
   if(action==="view"){const plain=decryptChildPassword(child,r.password_cipher);return {password:plain};}
   if(action==="enroll"){
    await client.query("RESET ROLE");
    const raw=sessionToken(request);if(raw)await client.query("SELECT auth.logout_session($1)",[digest(raw)]);
   }
   return r;
  });
  const response=result.error?json({error:result.error},result.error==="child_password_rate_limited"?429:400):json({data:result});
  setChildCookie(response,token);if(action==="enroll"&&!result.error)clearCookie(response);
  return response;
 }catch(error){const e=error as {code?:string;message?:string};if(e.code==="P0001"&&business.has(e.message||""))return json({error:e.message},400);return failure(error);}
}
