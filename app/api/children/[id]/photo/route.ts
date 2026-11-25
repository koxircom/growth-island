import type {NextRequest} from "next/server";
import {sessionUser,childViewer,sessionToken,digest} from "@/lib/server/auth";
import {transaction} from "@/lib/server/db";
import {appOrigin,failure,HttpError,json} from "@/lib/server/http";
import {normalizePhoto,MAX_PHOTO_BYTES} from "@/lib/server/photo";
export const runtime="nodejs";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context={params:Promise<{id:string}>};
async function authorized<T>(request:NextRequest,fn:(client:import("pg").PoolClient)=>Promise<T>,allowVisitor=false){
 return transaction(async client=>{
  const user=allowVisitor?await childViewer(request,client):await sessionUser(request,client);
  if(!user)throw new HttpError(401,"authentication_required");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
  await client.query("SELECT set_config('request.session_hash',$1,true)",[sessionToken(request)?digest(sessionToken(request)!):""]);
  return fn(client);
 });
}
export async function GET(request:NextRequest,context:Context){
 try{
  const {id}=await context.params,photo=request.nextUrl.searchParams.get("v")||"";
  if(!uuid.test(id)||!uuid.test(photo))throw new HttpError(404,"not_found");
  const bytes=await authorized(request,async client=>(await client.query("SELECT public.read_child_photo($1,$2) AS image",[id,photo])).rows[0].image,true);
  if(!bytes)throw new HttpError(404,"not_found");
  return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"}});
 }catch(e){return failure(e);}
}
export async function POST(request:NextRequest,context:Context){
 try{
  if(request.headers.get("origin")!==appOrigin()||request.headers.get("sec-fetch-site")==="cross-site")throw new HttpError(403,"origin_not_allowed");
  const {id}=await context.params;
  if(!uuid.test(id))throw new HttpError(400,"invalid_request");
  const token=request.headers.get("x-parent-token")||"";
  if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(403,"parent_required");
  // Check ownership/parent before reading or decoding potentially expensive bytes.
  await authorized(request,async client=>{
   const result=await client.query("SELECT public.can_upload_child_photo($1,$2) AS allowed",[id,token]);
   if(!result.rows[0].allowed)throw new HttpError(403,"parent_required");
  });
  if(!["image/jpeg","image/png","image/webp"].includes(request.headers.get("content-type")||""))throw new HttpError(415,"invalid_photo");
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"invalid_photo");
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PHOTO_BYTES){await reader.cancel();throw new HttpError(413,"photo_too_large");}chunks.push(value);}
  const image=await normalizePhoto(Buffer.concat(chunks));
  const data=await authorized(request,async client=>(await client.query("SELECT public.child_photo($1,$2,$3) AS data",[id,image,token])).rows[0].data);
  return json({data});
 }catch(e){
  if((e as {message?:string}).message==="parent_required")return json({error:"parent_required"},403);
  return failure(e);
 }
}
