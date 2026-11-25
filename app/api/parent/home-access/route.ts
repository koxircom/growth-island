import type {NextRequest} from 'next/server';
import {sessionUser,sessionToken,digest} from '@/lib/server/auth';
import {transaction} from '@/lib/server/db';
import {failure,HttpError,json,readBody} from '@/lib/server/http';
import {openHomeAccess} from '@/lib/server/home-access';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request);
  if(typeof body.parent_token!=='string'||!/^[a-f0-9]{64}$/.test(body.parent_token))throw new HttpError(403,'parent_required');
  await transaction(async client=>{
   const user=await sessionUser(request,client);if(!user)throw new HttpError(401,'authentication_required');
   await client.query('SET LOCAL ROLE authenticated');
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.session_hash',$2,true)",[user.id,digest(sessionToken(request)!)]);
   // Existing parent-only function enforces family, login session and parent capability.
   // Its private contents are discarded and never returned to this endpoint's caller.
   await client.query('SELECT public.get_switch_operations($1)',[body.parent_token]);
  });
  return json({data:await openHomeAccess()});
 }catch(error){
  if((error as Error).message==='parent_required')return json({error:'parent_required'},403);
  return failure(error);
 }
}
