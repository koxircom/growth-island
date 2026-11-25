import type {NextRequest} from 'next/server';
import {childViewer,sessionToken,digest} from '@/lib/server/auth';
import {setChildContext} from '@/lib/server/child-access';
import {transaction} from '@/lib/server/db';
import {readBody,json,failure,HttpError} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:NextRequest){try{
 const b=await readBody(request);
 if(Object.keys(b).some(k=>!['habit_id','child_id','parent_token'].includes(k))||typeof b.habit_id!=='string'||typeof b.child_id!=='string'||(b.parent_token!=null&&(typeof b.parent_token!=='string'||!/^[a-f0-9]{64}$/.test(b.parent_token))))throw new HttpError(400,'invalid_request');
 const data=await transaction(async c=>{const u=await childViewer(request,c);if(!u)throw new HttpError(401,'authentication_required');
 await c.query('SET LOCAL ROLE authenticated');
 await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.session_hash',$2,true)",[u.id,u.visitor?'':digest(sessionToken(request)!)]);
 await setChildContext(c,request);
 return (await c.query('SELECT public.habit_voice_read($1::uuid,$2::uuid,$3::text) data',[b.habit_id,b.child_id,u.visitor?null:b.parent_token||null])).rows[0].data;});
 const response=json({data});response.headers.set('Cache-Control','no-store, private');return response;
}catch(e){if((e as Error).message==='child_unlock_required')return json({error:'child_unlock_required'},403);return failure(e)}}
