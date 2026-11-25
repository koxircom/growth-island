import {randomBytes} from "node:crypto";
import type {NextRequest,NextResponse} from "next/server";
import type {PoolClient} from "pg";
import {appOrigin} from "./http";
import {digest} from "./auth";
export function childCookieOptions(){const secure=appOrigin().startsWith("https:");return {name:secure?"__Host-growth_child_browser":"growth_child_browser",secure,httpOnly:true,sameSite:"strict" as const,path:"/",maxAge:30*86400};}
export function childBrowser(request:NextRequest,create=false){const value=request.cookies.get(childCookieOptions().name)?.value||"";return /^[a-f0-9]{64}$/.test(value)?value:create?randomBytes(32).toString("hex"):"";}
export async function setChildContext(client:PoolClient,request:NextRequest,token?:string){const raw=token??childBrowser(request);await client.query("SELECT set_config('request.child_browser_hash',$1,true)",[raw?digest(raw):""]);}
export function setChildCookie(response:NextResponse,token:string){response.cookies.set({...childCookieOptions(),value:token});}
