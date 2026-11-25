import type {NextRequest} from 'next/server';
import {childViewer} from '@/lib/server/auth';
import {setChildContext} from '@/lib/server/child-access';
import {transaction} from '@/lib/server/db';
import {failure,HttpError,json,readBody} from '@/lib/server/http';
export const runtime='nodejs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:NextRequest){try{
 const body=await readBody(request);
 if(typeof body.child_id!=='string'||!uuid.test(body.child_id)||typeof body.rule_id!=='string'||!uuid.test(body.rule_id)||!Number.isSafeInteger(body.expected_revision)||Number(body.expected_revision)<1||typeof body.request_id!=='string'||!uuid.test(body.request_id)||Object.keys(body).some(k=>!['child_id','rule_id','expected_revision','request_id'].includes(k)))throw new HttpError(400,'invalid_request');
 const data=await transaction(async client=>{const user=await childViewer(request,client);if(!user)throw new HttpError(401,'authentication_required');await client.query('SET LOCAL ROLE authenticated');await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);await setChildContext(client,request);return(await client.query('SELECT public.peer_penalty_save($1::jsonb,$2::uuid) result',[JSON.stringify({child_id:body.child_id,rule_id:body.rule_id,expected_revision:body.expected_revision}),body.request_id])).rows[0].result;});return json({data});
 }catch(e){const err=e as {code?:string;message?:string};if(err.code==='P0001'&&['family_not_found','child_not_found','invalid_request','idempotency_conflict','star_daily_limit','insufficient_stars','peer_penalty_recent','penalty_rule_conflict'].includes(err.message||''))return json({error:err.message},409);if(err.code==='22P02')return json({error:'invalid_request'},400);return failure(e);}}
