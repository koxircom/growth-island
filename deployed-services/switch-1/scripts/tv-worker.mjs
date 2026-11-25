import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {createTvClient} from './tv-client.mjs';

export async function reconcileOperation(db, tv, operation) {
  // Always look up before replaying, including after worker restart or a lost HTTP reply.
  let result=await tv.operation(operation.request_id);
  if(result.found===false) {
    result=operation.action==='config'
      ? await tv.configure(operation.payload)
      : await tv.execute(operation.action,operation.payload ?? {request_id:operation.request_id,usage_id:operation.usage_id,seconds:operation.seconds});
  }
  if(result.request_id!==operation.request_id || typeof result.accepted!=='boolean' || result.operation_status!==(result.accepted?'applied':'rejected')) throw new Error('invalid_tv_result');
  await db.query('SELECT public.tv_resolve_operation($1::uuid,$2::jsonb)',[operation.request_id,JSON.stringify(result)]);
}

async function main() {
 const secret=process.env.TV_API_KEY_FILE ? (await readFile(process.env.TV_API_KEY_FILE,'utf8')).trim() : process.env.TV_API_KEY;
 if(!process.env.TV_DATABASE_URL) throw new Error('TV_DATABASE_URL is required');
 const tv=createTvClient({baseUrl:process.env.TV_API_URL,secret});
 const db=new pg.Pool({connectionString:process.env.TV_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
 db.on('error',()=>console.error('TV database unavailable; pending operations retained.'));
 let stopped=false;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
 try {
  do {
   try {
    const claimed=await db.query('SELECT public.tv_claim_operation() AS operation');
    const operation=claimed.rows[0]?.operation;
    if(operation) await reconcileOperation(db,tv,operation);
    const sessions=await db.query('SELECT public.tv_sessions_to_poll() AS sessions');
    for(const session of sessions.rows[0]?.sessions ?? []) {
      const result=await tv.session(session.usage_id);
      await db.query('SELECT public.tv_resolve_session($1::uuid,$2::jsonb)',[session.usage_id,JSON.stringify(result)]);
    }
   } catch {
    // Never print payloads, credentials, child details or remote error bodies.
    console.error('TV reconciliation pending; retrying durable request IDs without refund.');
    if(process.argv.includes('--once')) process.exitCode=1;
   }
   try {
    const config=await tv.config();
    await db.query('SELECT public.tv_update_config($1::jsonb)',[JSON.stringify(config)]);
    const status=await tv.status();
    await db.query('SELECT public.tv_update_status($1::jsonb)',[JSON.stringify(status)]);
    await writeFile('/tmp/growth-tv-remote-health',String(Date.now()),{mode:0o600});
   } catch { console.error('TV configuration refresh pending.'); }
   await writeFile('/tmp/growth-tv-worker-health',String(Date.now()),{mode:0o600});
   if(process.argv.includes('--once'))break;
   if(!stopped) await new Promise(resolve=>setTimeout(resolve,5000));
  } while(!stopped);
 } finally {await db.end();}
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) await main();







