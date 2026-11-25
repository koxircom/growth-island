// Application worker: no host access, no administrator credentials, no device control.
import pg from "pg";
import {writeFile} from "node:fs/promises";
const url=process.env.DATABASE_URL;
if(!url) throw new Error("DATABASE_URL is required");
const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
pool.on("error",()=>console.error("Settlement connection interrupted; retrying with the same limited account."));
let stopping=false,wake;
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{stopping=true;wake?.();});
const delay=()=>new Promise(resolve=>{const timer=setTimeout(resolve,5000);wake=()=>{clearTimeout(timer);resolve();};});
try {
 do {
  try {
   const r=await pool.query("SELECT public.settle_expired_device_usage() AS settled");
   const stars=await pool.query("SELECT public.settle_due_star_rules() AS settled");
   if(stars.rows[0].settled)console.log("Settled star periods:",stars.rows[0].settled);
   await writeFile("/tmp/growth-time-settler-health",String(Date.now()),{mode:0o600});
   if(r.rows[0].settled)console.log("Settled expired reservations:",r.rows[0].settled);
  } catch {console.error("Time settlement unavailable; will retry without changing credentials or permissions.");if(process.argv.includes("--once"))process.exitCode=1;}
  if(process.argv.includes("--once"))break;
  if(!stopping)await delay();
 }while(!stopping);
} finally {await pool.end();}
