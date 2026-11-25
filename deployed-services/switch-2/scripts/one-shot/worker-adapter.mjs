// ISOLATED CANDIDATE. Called only by the existing sole worker using its SwitchLink.
// Never creates a transport, changes a binding, calls production wallet APIs,
// queries the device, or retries a publication after dispatch intent is recorded.
import {switchCommandHash} from '../switch-protocol.mjs';
function ready(link,op,now){
 const s=link.fresh();
 if(!s||!s.clock_trusted||!s.native_verified||s.reason!=='ok')return null;
 if(s.console_id!==op.console_id||s.binding_id!==op.binding_id||link.config.console_id!==op.console_id||link.config.binding_id!==op.binding_id)return null;
 if(!['none','ended'].includes(s.session_state)||s.sequence!==op.sequence-1)return null;
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(op.authorized_until)||now>=op.authorized_until)return null;
 return s;
}
export async function runOneShot(journal,link,input,{now=()=>Math.floor(Date.now()/1000),cancelled=()=>false,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(cancelled())return 'cancelled';
 const op=await journal.current(input.request_id);
 if(!op||op.total_seconds!==600||op.action!=='start')throw Error('one_shot_scope_mismatch');
 if(op.phase==='closed')return 'closed';
 let command=op.command;
 if(command&&switchCommandHash(command)!==op.command_hash)throw Error('one_shot_journal_mismatch');
 // An authenticated correlated terminal result may arrive after a response loss.
 if(command){
  const result=link.result(command);
  if(result){await journal.observe(op,result,link.receipts.get(command.request_id));return result.phase;}
 }
 if(['dispatching','unknown','applied'].includes(op.phase))return 'awaiting_receipt_no_resend';
 if(!['queued','prepared'].includes(op.phase))return 'blocked';
 let s=ready(link,op,now());if(!s||cancelled())return 'not_ready';
 if(!command){
  const at=now();command={v:1,action:'start',console_id:op.console_id,binding_id:op.binding_id,boot_id:s.boot_id,sequence:op.sequence,request_id:op.request_id,session_id:op.usage_id,total_seconds:600,issued_at:at,accept_before:Math.min(at+60,op.authorized_until),query_request_id:''};
  if(command.accept_before<=at)return 'expired';
  await journal.prepare(op,command,switchCommandHash(command));
 }
 if(command.action!=='start'||command.total_seconds!==600||command.request_id!==op.request_id||command.session_id!==op.usage_id||command.sequence!==op.sequence||command.console_id!==op.console_id||command.binding_id!==op.binding_id)throw Error('one_shot_command_scope_mismatch');
 if(!Number.isSafeInteger(command.issued_at)||!Number.isSafeInteger(command.accept_before)||command.accept_before<=command.issued_at||command.accept_before>command.issued_at+60||command.accept_before>op.authorized_until||command.issued_at>now())throw Error('one_shot_command_expiry_mismatch');
 s=ready(link,op,now());
 if(!s||s.boot_id!==command.boot_id||now()>=command.accept_before||cancelled())return 'not_ready';
 // Ambiguous DB response is deliberately fatal BEFORE any transport action.
 if(await journal.dispatchOnce(op,switchCommandHash(command))!==true)return 'dispatch_not_authorized_or_recorded';
 if(!Number.isSafeInteger(command.issued_at)||!Number.isSafeInteger(command.accept_before)||command.accept_before<=command.issued_at||command.accept_before>command.issued_at+60||command.accept_before>op.authorized_until||command.issued_at>now())throw Error('one_shot_command_expiry_mismatch');
 s=ready(link,op,now());
 if(!s||s.boot_id!==command.boot_id||now()>=command.accept_before||cancelled()){await journal.unknown(op);return 'unknown_not_sent';}
 try{link.execute(command);}catch{await journal.unknown(op);return 'unknown';}
 await wait(1800);
 const result=link.result(command);
 if(result){await journal.observe(op,result,link.receipts.get(command.request_id));return result.phase;}
 await journal.unknown(op);return 'unknown';
}
