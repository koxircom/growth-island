
import type {NextRequest} from 'next/server';
import {sessionUser,login,setCookie,digest} from '@/lib/server/auth';
import {pool} from '@/lib/server/db';
import {hashPassword,validPassword} from '@/lib/server/password.mjs';
import {json,readBody,failure,HttpError} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 try{
  const body=await readBody(request),user=await sessionUser(request);
  if(!user)throw new HttpError(401,'invalid_credentials');
  if(!validPassword(body.password))throw new HttpError(400,'password_nonempty');
  if(body.password!==body.confirmation)throw new HttpError(400,'password_mismatch');
  const verified=await login({password:body.currentPassword});
  if(verified.user.id!==user.id)throw new HttpError(403,'invalid_credentials');
  try{await pool().query('SELECT auth.replace_household_password($1,$2,$3,$4)',[user.id,await hashPassword(body.password as string),digest(verified.token),verified.credentialHash]);}catch(e){if(e instanceof Error&&e.message==='stale_credentials')throw new HttpError(409,'credentials_changed');throw e;}
  const response=json({ok:true});setCookie(response,verified.token);return response;
 }catch(e){return failure(e)}
}
