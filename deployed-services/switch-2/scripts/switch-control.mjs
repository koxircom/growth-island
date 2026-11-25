// Operator commissioning/rollback only. Never exposed through the child API.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(){throw Error('invalid_switch_control');}
function canonical(domain,fields){return Buffer.from(domain+'\n'+fields.join('\n')+'\n','ascii');}
function digest(key,bytes){if(!Buffer.isBuffer(key)||key.length!==32)invalid();return createHmac('sha256',key).update(bytes).digest('hex');}
export function createSwitchControl({console_id,binding_id,action,request_id,boot_id,accept_before},key){
 if(!/^[a-f0-9]{8}$/.test(console_id)||!uuid.test(binding_id)||!['arm','restore'].includes(action)||!uuid.test(request_id)||!uuid.test(boot_id)||!Number.isSafeInteger(accept_before)||accept_before<=0)invalid();
 const fields=[console_id,binding_id,action,request_id,boot_id,accept_before],bytes=canonical('GI-SWITCH-CONTROL/1',fields),mac=digest(key,bytes);
 return {console_id,binding_id,action,request_id,boot_id,accept_before,command_hash:createHash('sha256').update(bytes).digest('hex'),wire:`GA1|${action}|${request_id}|${boot_id}|${accept_before}|${mac}`};
}
export function verifySwitchControlResult(result,expected,key){
 if(!result||typeof result!=='object'||Object.keys(result).sort().join(',')!==['action','request_id','boot_id','command_hash','phase','reason','mac'].sort().join(','))invalid();
 for(const field of ['action','request_id','boot_id','command_hash'])if(result[field]!==expected[field])invalid();
 if(!['prepared','applied','rejected','unknown'].includes(result.phase)||!['ok','conflict','stale_boot','clock_untrusted','expired','busy','enforcement_failed'].includes(result.reason)||!/^[a-f0-9]{64}$/.test(result.mac))invalid();
 if(result.phase==='applied'&&result.reason!=='ok')invalid();
 const bytes=canonical('GI-SWITCH-CONTROL-RESULT/1',[expected.console_id,expected.binding_id,result.action,result.request_id,result.boot_id,result.command_hash,result.phase,result.reason]);
 if(!timingSafeEqual(Buffer.from(digest(key,bytes),'hex'),Buffer.from(result.mac,'hex')))invalid();
 return Object.freeze({...result});
}
