// Growth Island device protocol draft. No transport, keys, wallet or device writes.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

export const SWITCH_PROTOCOL_VERSION=1;
export const MAX_SWITCH_BUDGET_SECONDS=10800;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64=/^[0-9a-f]{64}$/;
const COMMAND_FIELDS=['v','action','console_id','binding_id','boot_id','sequence','request_id','session_id','total_seconds','issued_at','accept_before','query_request_id'];
const RESULT_FIELDS=['v','action','console_id','binding_id','request_id','session_id','sequence','request_hash','phase','session_state','granted_seconds','consumed_ns','remaining_ns','reason'];
const REASONS=new Set(['ok','expired','busy','conflict','sequence_gap','stale_boot','clock_untrusted','policy_changed','unsupported','storage_failed','enforcement_failed','unknown','not_found']);

function fail(){throw new Error('invalid_switch_protocol_message');}
function integer(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
function uuid(s){return typeof s==='string'&&UUID.test(s);}
function hex64(s){return typeof s==='string'&&HEX64.test(s);}
function exactKeys(value,fields,signed){
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const keys=Object.keys(value).sort();
 const expected=[...fields,...(signed?['mac']:[])].sort();
 if(keys.length!==expected.length||keys.some((k,i)=>k!==expected[i]))fail();
}
function checkKey(key){if(!Buffer.isBuffer(key)||key.length!==32)fail();}
function validIdentity(d){
 return d.v===1&&typeof d.console_id==='string'&&/^[0-9a-f]{8}$/.test(d.console_id)&&uuid(d.binding_id)&&uuid(d.request_id)&&uuid(d.session_id);
}
function command(d,signed=false){
 exactKeys(d,COMMAND_FIELDS,signed);
 if(!validIdentity(d)||!uuid(d.boot_id)||!['start','extend','stop','query'].includes(d.action))fail();
 if(!integer(d.issued_at,0,Number.MAX_SAFE_INTEGER)||!integer(d.accept_before,1,Number.MAX_SAFE_INTEGER)||
    d.accept_before<=d.issued_at||d.accept_before-d.issued_at>120)fail();
 if(d.action==='query'){
  if(d.sequence!==0||d.total_seconds!==0||!uuid(d.query_request_id))fail();
 }else{
  if(!integer(d.sequence,1,Number.MAX_SAFE_INTEGER)||d.query_request_id!=='')fail();
  if(d.action==='stop'){if(d.total_seconds!==0)fail();}
  else if(!integer(d.total_seconds,1,MAX_SWITCH_BUDGET_SECONDS))fail();
 }
 if(signed&&!hex64(d.mac))fail();
 return d;
}
function ns(s){
 if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,13})$/.test(s))fail();
 const n=BigInt(s);
 if(n>BigInt(MAX_SWITCH_BUDGET_SECONDS)*1000000000n)fail();
 return n;
}
function result(d,signed=false){
 exactKeys(d,RESULT_FIELDS,signed);
 if(!validIdentity(d)||!['start','extend','stop'].includes(d.action)||!integer(d.sequence,1,Number.MAX_SAFE_INTEGER)||!hex64(d.request_hash))fail();
 if(!['prepared','applied','rejected','expired','unknown'].includes(d.phase)||
    !['none','playing','paused','exhausted','ended','unknown'].includes(d.session_state)||!REASONS.has(d.reason)||
    !integer(d.granted_seconds,0,MAX_SWITCH_BUDGET_SECONDS))fail();
 const used=ns(d.consumed_ns),left=ns(d.remaining_ns);
 if(used+left!==BigInt(d.granted_seconds)*1000000000n)fail();
 if(d.phase==='applied'&&d.reason!=='ok')fail();
 if(d.phase==='applied'&&d.action==='stop'&&d.session_state!=='ended')fail();
 if(d.session_state==='exhausted'&&left!==0n)fail();
 if(signed&&!hex64(d.mac))fail();
 return d;
}
function canonical(domain,fields,d){return Buffer.from(domain+'\n'+fields.map(k=>String(d[k])).join('\n')+'\n','ascii');}
function body(fields,d){return Object.fromEntries(fields.map(k=>[k,d[k]]));}
function mac(key,bytes){checkKey(key);return createHmac('sha256',key).update(bytes).digest('hex');}
function parse(wire,max){
 if(typeof wire!=='string'||Buffer.byteLength(wire)>max)fail();
 try{return JSON.parse(wire);}catch{fail();}
}
function authentic(expected,actual){return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'));}

export function canonicalSwitchCommand(d){command(d);return canonical('GI-SWITCH-COMMAND/1',COMMAND_FIELDS,d);}
export function switchCommandHash(d){return createHash('sha256').update(canonicalSwitchCommand(d)).digest('hex');}
export function signSwitchCommand(d,key){
 const clean=body(COMMAND_FIELDS,command(d));
 return JSON.stringify({...clean,mac:mac(key,canonicalSwitchCommand(clean))});
}
export function verifySwitchCommand(wire,key){
 const d=command(parse(wire,2048),true);const clean=body(COMMAND_FIELDS,d);
 if(!authentic(mac(key,canonicalSwitchCommand(clean)),d.mac))fail();
 return Object.freeze(clean);
}

// Authenticate before looking up durable history. Expiry applies only to a new
// mutation; an old identical request may return its persisted result, never run again.
export function canAcceptNewSwitchCommand(d,{consoleId,bindingId,bootId,clockTrusted,nowSeconds}){
 command(d);
 if(d.console_id!==consoleId||d.binding_id!==bindingId)return {accepted:false,reason:'conflict'};
 if(d.boot_id!==bootId)return {accepted:false,reason:'stale_boot'};
 if(clockTrusted!==true||!integer(nowSeconds,0,Number.MAX_SAFE_INTEGER))return {accepted:false,reason:'clock_untrusted'};
 if(nowSeconds>=d.accept_before)return {accepted:false,reason:'expired'};
 if(d.issued_at>nowSeconds+30)return {accepted:false,reason:'clock_untrusted'};
 return {accepted:true,reason:'ok'};
}
export function signSwitchResult(d,key){
 const clean=body(RESULT_FIELDS,result(d));
 return JSON.stringify({...clean,mac:mac(key,canonical('GI-SWITCH-RESULT/1',RESULT_FIELDS,clean))});
}
export function verifySwitchResult(wire,key,originalCommand){
 command(originalCommand);
 if(originalCommand.action==='query')fail();
 const d=result(parse(wire,3072),true);const clean=body(RESULT_FIELDS,d);
 if(!authentic(mac(key,canonical('GI-SWITCH-RESULT/1',RESULT_FIELDS,clean)),d.mac))fail();
 for(const k of ['action','console_id','binding_id','request_id','session_id','sequence'])if(d[k]!==originalCommand[k])fail();
 if(d.request_hash!==switchCommandHash(originalCommand))fail();
 if(d.phase==='applied'&&d.action!=='stop'&&(d.granted_seconds!==originalCommand.total_seconds||!['playing','paused','exhausted'].includes(d.session_state)))fail();
 return Object.freeze(clean);
}
