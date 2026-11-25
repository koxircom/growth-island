import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {SwitchMqtt} from '../switch-mqtt.mjs';
import {signSwitchCommand,switchCommandHash,verifySwitchResult} from '../switch-protocol.mjs';
import {verifySwitchState,publicSwitchSnapshot} from '../switch-state.mjs';
import {assertReturnedBinding,claimOperationQuery,requireSwitchBindingId,sessionsToPollQuery} from '../switch-routing.mjs';

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
 let command=operation.command;
 if(command&&switchCommandHash(command)!==operation.command_hash)throw Error('switch_command_journal_mismatch');
 let result=command?link.result(command):null;
 if(result){await db.query('SELECT public.switch_resolve_operation($1::uuid,$2::jsonb)',[operation.request_id,JSON.stringify(result)]);return result.phase;}
 // A null journal on an old prepared operation is not proof of non-delivery.
 if(command){
  const delivery=(await db.query('SELECT public.switch_dispatch_state($1::uuid) AS state',[operation.request_id])).rows[0]?.state;
  if(delivery!=='unsent')return 'awaiting_receipt_no_resend';
 }
 if(operation.action!=='stop'&&(!state.clock_trusted||!state.native_verified||state.reason!=='ok'))return 'not_ready';
 if(!Number.isSafeInteger(operation.sequence)||state.sequence!==operation.sequence-1)return 'state_conflict';
 if(operation.action==='start'&&!((state.session_state==='none'&&state.session_id==='')||(['ended','exhausted'].includes(state.session_state)&&state.session_id!=='')))return 'state_conflict';
 if(operation.action!=='start'&&state.session_id!==operation.usage_id)return 'state_conflict';
 const now=Math.floor(Date.now()/1000);
 command={v:1,action:operation.action,console_id:operation.console_id,binding_id:operation.binding_id,boot_id:state.boot_id,sequence:Number(operation.sequence),request_id:operation.request_id,session_id:operation.usage_id,total_seconds:operation.action==='stop'?0:operation.total_seconds,issued_at:now,accept_before:now+90,query_request_id:''};
 if(cancelled())return 'cancelled';
 await db.query('SELECT public.switch_prepare_operation($1::uuid,$2::jsonb,$3)',[operation.request_id,JSON.stringify(command),switchCommandHash(command)]);
 const safe=()=>{
  const current=link.fresh();
  if(!current||current.console_id!==command.console_id||current.binding_id!==command.binding_id
    ||current.boot_id!==command.boot_id||current.sequence!==command.sequence-1
    ||Math.floor(Date.now()/1000)>=command.accept_before)return false;
  if(command.action!=='stop'&&(!current.clock_trusted||!current.native_verified||current.reason!=='ok'))return false;
  if(command.action==='start')return (current.session_state==='none'&&current.session_id==='')||(['ended','exhausted'].includes(current.session_state)&&current.session_id!=='');
  return current.session_id===command.session_id;
 };
 if(cancelled()||!safe())return 'prepared_waiting_no_send';
 // A lost response throws before publish. Never infer permission from a retry.
 const permission=(await db.query('SELECT public.switch_dispatch_once($1::uuid,$2) AS allowed',[operation.request_id,switchCommandHash(command)])).rows[0]?.allowed;
 if(permission!==true)return 'dispatch_not_authorized_or_recorded';
 if(cancelled()||!safe())return 'dispatch_recorded_no_send';
 // Only this successful CAS caller owns one attempt. No query/publish recovery.
 link.execute(command);await wait(1800);result=link.result(command);
 if(!result)return 'unknown';
 await db.query('SELECT public.switch_resolve_operation($1::uuid,$2::jsonb)',[operation.request_id,JSON.stringify(result)]);
 return result.phase;
}

async function main(){
 if(!process.env.SWITCH_CONFIG_FILE||!process.env.SWITCH_DATABASE_URL)throw Error('switch_worker_configuration_required');
 const config=JSON.parse(await readFile(process.env.SWITCH_CONFIG_FILE,'utf8'));
 if(!/^[a-f0-9]{64}$/.test(config.key_hex)||!/^[a-f0-9]{8}$/.test(config.console_id))throw Error('invalid_switch_config');
 requireSwitchBindingId(config);
 config.stateTopic=`boreale/${config.console_id}/playguard/state`;config.commandTopic=`boreale/${config.console_id}/playguard/growth_allocation/set`;
 const {default:pg}=await import('pg');
 const db=new pg.Pool({connectionString:process.env.SWITCH_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
 db.on('error',()=>console.error('Switch database unavailable; reservations retained.'));
 let stopped=false,mqtt,link,lastStatus=null;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;mqtt?.close();});
 try{do{
  try{
   if(!mqtt?.open){mqtt?.close();mqtt=new SwitchMqtt({...config.mqtt,clientId:'growth-switch-'+randomUUID().slice(0,8)});link=new SwitchLink(config,mqtt);mqtt.on('message',m=>link.receive(m));await mqtt.connect();mqtt.subscribe(config.stateTopic);}
   const fresh=link.fresh();
   if(fresh){
    const fingerprint=fresh.boot_id+':'+fresh.sample_sequence;
    if(fingerprint!==lastStatus){await db.query('SELECT public.switch_update_status($1::jsonb)',[JSON.stringify(publicSwitchSnapshot(fresh))]);lastStatus=fingerprint;}
     const bindingId=requireSwitchBindingId(link.config),claimQuery=claimOperationQuery(bindingId);
     const claimed=switchCanClaim(fresh)?assertReturnedBinding((await db.query(claimQuery.sql,claimQuery.params)).rows[0]?.operation,bindingId):null;
    if(claimed)await reconcileSwitchOperation(db,link,claimed);
     const pollQuery=sessionsToPollQuery(bindingId),sessions=(await db.query(pollQuery.sql,pollQuery.params)).rows[0]?.sessions??[];
     if(!Array.isArray(sessions))throw Error('switch_sessions_invalid');
     for(const raw of sessions){const s=assertReturnedBinding(raw,bindingId),id=s.session_id||s.usage_id||s.id,current=link.fresh();if(current&&current.binding_id===bindingId&&current.session_id===id)await db.query('SELECT public.switch_resolve_session($1::uuid,$2::jsonb)',[id,JSON.stringify(publicSwitchSnapshot(current))]);}
    await writeFile('/tmp/growth-switch-remote-health',String(Date.now()),{mode:0o600});
   }
   await writeFile('/tmp/growth-switch-worker-health',String(Date.now()),{mode:0o600});
  }catch{console.error('Switch reconciliation pending; original request and reservations retained.');if(process.argv.includes('--once'))process.exitCode=1;}
  if(process.argv.includes('--once'))break;
  if(!stopped)await new Promise(r=>setTimeout(r,1000));
 }while(!stopped);}finally{mqtt?.close();link?.key.fill(0);await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)throw Error('import_only_use_integrated_worker_main');
