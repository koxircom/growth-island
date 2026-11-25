import type {NextRequest} from 'next/server';
import {sessionUser,sessionToken,digest} from '@/lib/server/auth';
import {transaction} from '@/lib/server/db';
import {failure,HttpError,json,readBody} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request);
  if(typeof body.parent_token!=='string'||!/^[a-f0-9]{64}$/.test(body.parent_token))throw new HttpError(403,'parent_required');
  if(!['stars','seconds'].includes(String(body.unit))||!Number.isInteger(body.page)||Number(body.page)<0||Number(body.page)>100000||(body.child_id!==null&&(typeof body.child_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.child_id))))throw new HttpError(400,'invalid_request');
  const data=await transaction(async client=>{
   const user=await sessionUser(request,client);if(!user)throw new HttpError(401,'authentication_required');
   await client.query('SET LOCAL ROLE authenticated');
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.session_hash',$2,true)",[user.id,digest(sessionToken(request)!)]);
   return(await client.query('SELECT public.get_account_book($1,$2::uuid,$3,$4::integer) result',[body.parent_token,body.child_id,body.unit,body.page])).rows[0].result;
  });
  return json({data});
 }catch(e){if((e as Error).message==='parent_required')return json({error:'parent_required'},403);if((e as Error).message==='child_not_found')return json({error:'child_not_found'},400);return failure(e);}
}
