import {createIntegratedWorker} from './one-shot/integrated-worker.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {SwitchMqtt} from './switch-mqtt.mjs';
import {signSwitchCommand,switchCommandHash,verifySwitchResult} from './switch-protocol.mjs';
import {verifySwitchState,publicSwitchSnapshot} from './switch-state.mjs';
import {requireSwitchBindingId} from './switch-routing.mjs';

export class SwitchLink{
 constructor(config,mqtt){this.config=config;this.mqtt=mqtt;this.key=Buffer.from(config.key_hex,'hex');this.receipts=new Map();this.sequences=new Map();this.last=null;}
 receive(message){
  if(message.retained||message.topic!==this.config.stateTopic)return false;
  try{
   const envelope=JSON.parse(message.payload);
   if(envelope.source!=='agent'||envelope.console?.emummc!==true||envelope.console?.firmware!=='21.2.0')return false;
   const data=envelope.growth_allocation;if(!data?.state)return false;
   const state=verifySwitchState(JSON.stringify(data.state),this.key,{consoleId:this.config.console_id,bindingId:this.config.binding_id});
   const prev=this.sequences.get(state.boot_id)||0;if(state.sample_sequence<=prev)return false;
   this.sequences.set(state.boot_id,state.sample_sequence);if(this.sequences.size>16)this.sequences.delete(this.sequences.keys().next().value);
   this.last={state,received:Date.now(),rawWire:JSON.stringify(data.state)};
   if(data.receipt&&typeof data.receipt==='object')this.receipts.set(data.receipt.request_id,JSON.stringify(data.receipt));
   if(this.receipts.size>64)this.receipts.delete(this.receipts.keys().next().value);
   return true;
  }catch{return false;}
 }
 fresh(){return this.last&&Date.now()-this.last.received<15000?this.last.state:null;}
 result(command){try{return verifySwitchResult(this.receipts.get(command.request_id),this.key,command);}catch{return null;}}
 query(command){
  const state=this.fresh();if(!state)throw Error('switch_not_fresh');const now=Math.floor(Date.now()/1000);
  const query={...command,action:'query',boot_id:state.boot_id,sequence:0,request_id:randomUUID(),total_seconds:0,issued_at:now,accept_before:now+60,query_request_id:command.request_id};
  this.mqtt.publish(this.config.commandTopic,signSwitchCommand(query,this.key));
 }
 execute(command){this.mqtt.publish(this.config.commandTopic,signSwitchCommand(command,this.key));}
}

export function switchCanClaim(state){return !!state&&!['sleeping','paused','unknown'].includes(state.session_state);}

export async function reconcileSwitchOperation(db,link,operation,{wait=ms=>new Promise(r=>setTimeout(r,ms)),cancelled=()=>false}={}){
 if(cancelled())return 'cancelled';
 const state=link.fresh();if(!state)return 'offline';
 if(operation.console_id!==link.config.console_id||operation.binding_id!==link.config.binding_id)throw Error('switch_binding_mismatch');
 const existed=!!operation.command;
 let command=operation.command;
 if(!command){
  if(state.session_state==='sleeping'||state.session_state==='paused')return 'not_ready';
  if(operation.action!=='stop'&&(!state.clock_trusted||!state.native_verified||state.session_state==='unknown'))return 'not_ready';
  // Queued requests must not target a different physical session or consume a
  // sequence allocated before another controller changed the device.
  if(!Number.isSafeInteger(operation.sequence)||state.sequence!==operation.sequence-1)return 'state_conflict';
  if(operation.action==='start'&&!((state.session_state==='none'&&state.session_id==='')||(['ended','exhausted'].includes(state.session_state)&&state.session_id!=='')))return 'state_conflict';
  if(operation.action!=='start'&&state.session_id!==operation.usage_id)return 'state_conflict';
  const now=Math.floor(Date.now()/1000);
  command={v:1,action:operation.action,console_id:operation.console_id,binding_id:operation.binding_id,boot_id:state.boot_id,sequence:Number(operation.sequence),request_id:operation.request_id,session_id:operation.usage_id,total_seconds:operation.action==='stop'?0:operation.total_seconds,issued_at:now,accept_before:now+90,query_request_id:''};
  if(cancelled())return 'cancelled';
  await db.query('SELECT public.switch_prepare_operation($1::uuid,$2::jsonb,$3)',[operation.request_id,JSON.stringify(command),switchCommandHash(command)]);
 }else if(switchCommandHash(command)!==operation.command_hash)throw Error('switch_command_journal_mismatch');
 let result=link.result(command);
 if(!result&&(state.session_state==='sleeping'||state.session_state==='paused'||state.session_state==='unknown'))return 'not_ready';
 if(!result&&existed)return 'awaiting_receipt_no_resend';
 if(!result){
  if(cancelled())return 'cancelled';
  link.query(command);await wait(1200);result=link.result(command);
  if(!result){
   if(cancelled())return 'cancelled';
   link.execute(command);await wait(1800);result=link.result(command);
  }
 }
 if(!result)return 'unknown';
 await db.query('SELECT public.switch_resolve_operation($1::uuid,$2::jsonb)',[operation.request_id,JSON.stringify(result)]);
 return result.phase;
}

async function main(){
 if(process.env.SWITCH_TEST_CANDIDATE_ENABLE!=='isolated-reviewed')throw Error('candidate_not_enabled');
 if(!process.env.SWITCH_CONFIG_FILE||!process.env.SWITCH_DATABASE_URL)throw Error('switch_worker_configuration_required');
 const config=JSON.parse(await readFile(process.env.SWITCH_CONFIG_FILE,'utf8'));
 if(!/^[a-f0-9]{64}$/.test(config.key_hex)||!/^[a-f0-9]{8}$/.test(config.console_id))throw Error('invalid_switch_config');
 requireSwitchBindingId(config);
 config.stateTopic=`boreale/${config.console_id}/playguard/state`;config.commandTopic=`boreale/${config.console_id}/playguard/growth_allocation/set`;
 const {default:pg}=await import('pg');
 const db=new pg.Pool({connectionString:process.env.SWITCH_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
 db.on('error',()=>console.error('Switch database unavailable; reservations retained.'));
 const client=await db.connect();
 let stopped=false,mqtt,link,runtime;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
 try{do{
  try{
   if(stopped)break;
   if(!mqtt?.open){mqtt?.close();mqtt=new SwitchMqtt({...config.mqtt,clientId:'growth-switch-'+randomUUID().slice(0,8)});link=new SwitchLink(config,mqtt);runtime=createIntegratedWorker({client,link,cancelled:()=>stopped});mqtt.on('message',m=>link.receive(m));await mqtt.connect();if(stopped)break;mqtt.subscribe(config.stateTopic);}
   const fresh=link.fresh();
   if(fresh){
    await runtime.tick();
    await writeFile('/tmp/growth-switch-remote-health',String(Date.now()),{mode:0o600});
   }
   await writeFile('/tmp/growth-switch-worker-health',String(Date.now()),{mode:0o600});
  }catch{console.error('Switch reconciliation pending; original request and reservations retained.');if(process.argv.includes('--once'))process.exitCode=1;}
  if(process.argv.includes('--once'))break;
  if(!stopped)await new Promise(r=>setTimeout(r,1000));
 }while(!stopped);}finally{mqtt?.close();link?.key.fill(0);client.release();await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
