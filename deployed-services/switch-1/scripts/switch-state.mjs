import {createHmac,timingSafeEqual} from 'node:crypto';

export const SWITCH_STATE_FIELDS=['v','console_id','binding_id','boot_id','sample_sequence','observed_at','session_id','session_state','granted_seconds','consumed_ns','remaining_ns','clock_trusted','native_verified','sequence','reason'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer=(n,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function invalid(){throw Error('invalid_switch_state');}
function ns(s){if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,13})$/.test(s))invalid();return BigInt(s);}
function validate(s,signed=false){
 if(!s||typeof s!=='object'||Array.isArray(s))invalid();
 const wanted=[...SWITCH_STATE_FIELDS,...(signed?['mac']:[])].sort(),keys=Object.keys(s).sort();
 if(keys.length!==wanted.length||keys.some((k,i)=>k!==wanted[i]))invalid();
 if(s.v!==1||typeof s.console_id!=='string'||!/^[0-9a-f]{8}$/.test(s.console_id)||!uuid.test(s.binding_id)||!uuid.test(s.boot_id)||
  !integer(s.sample_sequence,1)||!integer(s.observed_at,1)||!integer(s.sequence,0)||!integer(s.granted_seconds,0,10800)||
  typeof s.clock_trusted!=='boolean'||typeof s.native_verified!=='boolean'||
  !['none','sleeping','playing','paused','exhausted','ended','unknown'].includes(s.session_state)||
  !['ok','expired','busy','conflict','sequence_gap','stale_boot','clock_untrusted','policy_changed','unsupported','storage_failed','enforcement_failed','unknown','not_found'].includes(s.reason))invalid();
 if(typeof s.session_id!=='string'||(s.session_id!==''&&!uuid.test(s.session_id)))invalid();
 if(s.session_id===''&&!(s.granted_seconds===0&&['none','sleeping','unknown'].includes(s.session_state)))invalid();
 if(s.session_state==='sleeping'&&(s.session_id!==''||s.granted_seconds!==0))invalid();
 const used=ns(s.consumed_ns),left=ns(s.remaining_ns);
 if(used+left!==BigInt(s.granted_seconds)*1000000000n||used>10800000000000n||left>10800000000000n)invalid();
 if(s.session_state==='exhausted'&&left!==0n)invalid();
 if(signed&&(typeof s.mac!=='string'||!/^[0-9a-f]{64}$/.test(s.mac)))invalid();
 return s;
}
export function canonicalSwitchState(s){validate(s);return Buffer.from('GI-SWITCH-STATE/1\n'+SWITCH_STATE_FIELDS.map(k=>String(s[k])).join('\n')+'\n','ascii');}
function clean(s){return Object.fromEntries(SWITCH_STATE_FIELDS.map(k=>[k,s[k]]));}
function mac(s,key){if(!Buffer.isBuffer(key)||key.length!==32)invalid();return createHmac('sha256',key).update(canonicalSwitchState(s)).digest('hex');}
export function signSwitchState(s,key){return JSON.stringify({...validate(s),mac:mac(s,key)});}
export function verifySwitchState(wire,key,{consoleId,bindingId,nowSeconds=Math.floor(Date.now()/1000),maxAgeSeconds=30}={}){
 if(typeof wire!=='string'||Buffer.byteLength(wire)>3072)invalid();
 let s;try{s=validate(JSON.parse(wire),true);}catch{invalid();}
 const body=clean(s),expected=mac(body,key);
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(s.mac,'hex')))invalid();
 if(s.console_id!==consoleId||s.binding_id!==bindingId||!integer(nowSeconds,1)||Math.abs(nowSeconds-s.observed_at)>maxAgeSeconds)invalid();
 return Object.freeze(body);
}
export function publicSwitchSnapshot(s){
 validate(s);
 return {...s,consumed_seconds:Number((BigInt(s.consumed_ns)+999999999n)/1000000000n),remaining_seconds:Number((BigInt(s.remaining_ns)+999999999n)/1000000000n)};
}
