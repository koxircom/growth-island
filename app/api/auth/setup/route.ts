
import type { NextRequest } from 'next/server';
import { pool,transaction } from '@/lib/server/db';
import { login,setCookie,digest } from '@/lib/server/auth';
import {hashPassword,validPassword} from '@/lib/server/password.mjs';
import {readBody,json,failure,HttpError} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(){
 try{
  const s=(await pool().query('SELECT user_id IS NOT NULL AS configured, user_id IS NULL AND setup_until>now() AS open FROM auth.household_login WHERE singleton')).rows[0];
  return json({configured:!!s?.configured,open:!!s?.open});
 }catch(e){return failure(e)}
}
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request);
  if(!validPassword(body.password))throw new HttpError(400,'password_nonempty');
  if(body.password!==body.confirmation)throw new HttpError(400,'password_mismatch');
  const s=(await pool().query('SELECT user_id IS NULL AND setup_until>now() AS open FROM auth.household_login WHERE singleton')).rows[0];
  if(!s?.open)throw new HttpError(409,'setup_closed');
  const allowed=await transaction(async client=>{
   const key=digest('household-setup');
   await client.query('INSERT INTO auth.login_attempts(key_hash,attempts) VALUES($1,0) ON CONFLICT DO NOTHING',[key]);
   const row=(await client.query("SELECT attempts,window_start < now()-interval '10 minutes' AS expired FROM auth.login_attempts WHERE key_hash=$1 FOR UPDATE",[key])).rows[0];
   if(!row.expired&&row.attempts>=5)return false;
   await client.query("UPDATE auth.login_attempts SET attempts=CASE WHEN window_start < now()-interval '10 minutes' THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start < now()-interval '10 minutes' THEN now() ELSE window_start END WHERE key_hash=$1",[key]);
   return true;
  });
  if(!allowed)throw new HttpError(429,'login_rate_limited');
  const hash=await hashPassword(body.password as string);
  try{await pool().query('SELECT auth.initialize_household($1)',[hash]);}
  catch{throw new HttpError(409,'setup_closed');}
  const session=await login({password:body.password});
  const response=json({session:{user:session.user}});setCookie(response,session.token);return response;
 }catch(e){return failure(e)}
}
