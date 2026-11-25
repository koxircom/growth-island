import {ledgerReadScope} from "@/lib/server/dashboard-scope";
import type {NextRequest} from 'next/server';
import {childViewer} from '@/lib/server/auth';
import {transaction} from '@/lib/server/db';
import {failure,HttpError,json} from '@/lib/server/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
try{
const q=request.nextUrl.searchParams,period=q.get('period')||'week',anchor=q.get('anchor'),child=q.get('child_id')||null;
if(!['week','month','year'].includes(period)||!anchor||!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||(child&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(child)))throw new HttpError(400,'invalid_request');
const data=await transaction(async client=>{
const user=await childViewer(request,client);if(!user)throw new HttpError(401,'authentication_required');
await client.query('SET LOCAL ROLE authenticated');
await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user.id]);
const scope=await ledgerReadScope(client,request,user);
if(scope.kind!=='parent' && scope.kind!=='family' && (!scope.child_id || (child && child!==scope.child_id)))throw new HttpError(403,'child_unlock_required');
return(await client.query('SELECT public.get_statistics($1,$2::date,$3::uuid) result',[period,anchor,scope.kind==='parent'||scope.kind==='family'?child:scope.child_id])).rows[0].result;
});return json({data});
}catch(e){if(['invalid_request','child_not_found'].includes((e as Error).message)||['22008','22007'].includes((e as {code?:string}).code||''))return json({error:'invalid_request'},400);return failure(e);}
}
