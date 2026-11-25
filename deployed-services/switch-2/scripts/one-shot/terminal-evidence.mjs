// Isolated candidate: verifies evidence only, never publishes or mutates a ledger.
import {switchCommandHash} from '../switch-protocol.mjs';
import {verifySwitchState} from '../switch-state.mjs';
export function terminalEvidence(wire,key,op,previous,{nowSeconds,allowActive=false}={}){
 const s=verifySwitchState(wire,key,{consoleId:op.console_id,bindingId:op.binding_id,nowSeconds,maxAgeSeconds:15});
 if(!op.command||!['dispatching','unknown','active','applied'].includes(op.phase))throw Error('operation_not_dispatched');
 const c=op.command;
 if(c.action!=='start'||c.total_seconds!==600||c.console_id!==op.console_id||c.binding_id!==op.binding_id||c.request_id!==op.request_id||c.session_id!==op.usage_id||c.sequence!==op.sequence||switchCommandHash(c)!==op.command_hash)throw Error('journal_mismatch');
 if(s.boot_id!==op.command.boot_id)throw Error('boot_changed_requires_reconciliation');
 if(s.session_id!==op.usage_id||s.sequence!==op.sequence||s.granted_seconds!==600)throw Error('operation_identity_mismatch');
 if(!s.clock_trusted||!s.native_verified||s.reason!=='ok')throw Error('untrusted_terminal');
 if(!(allowActive?['playing','paused','ended','exhausted']:['ended','exhausted']).includes(s.session_state))throw Error('not_terminal');
 if(previous&&(s.boot_id!==previous.boot_id||s.sample_sequence<=previous.sample_sequence||BigInt(s.consumed_ns)<BigInt(previous.consumed_ns)))throw Error('nonmonotonic_evidence');
 return Object.freeze({state:s,raw:wire,mayRelease:['ended','exhausted'].includes(s.session_state)});
}
