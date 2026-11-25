import {runWorkerCycle} from './worker-loop-adapter.mjs';
import {oneShotJournal} from './worker-journal.mjs';
import {recordEvidence} from './worker-evidence.mjs';
import {publicSwitchSnapshot} from '../switch-state.mjs';
import {assertReturnedBinding,claimOperationQuery,requireSwitchBindingId,sessionsToPollQuery} from '../switch-routing.mjs';
import {switchCanClaim,reconcileSwitchOperation} from './normal-worker.mjs';
// One instance per existing Link and dedicated Client. No transport construction.
export function createIntegratedWorker({client,link,wait,cancelled=()=>false}){
 const journal=oneShotJournal(client,link.key);
 let lastStatus=null;
 const updateStatus=async state=>{
  const fingerprint=state.boot_id+':'+state.sample_sequence;
  if(fingerprint===lastStatus)return;
  await client.query('SELECT public.switch_update_status($1::jsonb)',[JSON.stringify(publicSwitchSnapshot(state))]);
  lastStatus=fingerprint;
 };
 const normal=()=>runNormalBindingWork({client,link,wait,cancelled,updateStatus});
 // New per-console worker identities need not have access to the legacy
 // primary-console-only commissioning RPCs.
 if(link.config.one_shot_enabled===false)return {tick:normal};
 const selectRequestId=async()=> (await client.query('SELECT public.switch_test_select_request($1) id',[link.fresh()?.session_id||''])).rows[0]?.id;
 const options={transactionOwner:client,journal,link,normal,selectRequestId,wait,cancelled,
 recordVerified:(id,wire)=>recordEvidence(client,id,wire,link.key),updateStatus};
 return {tick:()=>runWorkerCycle(options)};
}

// Kept separate so the binding route can be regression-tested without
// constructing the one-shot journal or a live MQTT/PG connection.
export async function runNormalBindingWork({client,link,wait,cancelled=()=>false,updateStatus=async()=>{}}){
 if(cancelled())return;
 const fresh=link.fresh();if(!fresh)return;
 await updateStatus(fresh);
 if(cancelled())return;
 const bindingId=requireSwitchBindingId(link.config);
 const claimQuery=claimOperationQuery(bindingId);
 const claimed=switchCanClaim(fresh)
  ? assertReturnedBinding((await client.query(claimQuery.sql,claimQuery.params)).rows[0]?.operation,bindingId)
  : null;
 if(claimed&&!cancelled())await reconcileSwitchOperation(client,link,claimed,{wait,cancelled});
 const pollQuery=sessionsToPollQuery(bindingId);
 const sessions=(await client.query(pollQuery.sql,pollQuery.params)).rows[0]?.sessions??[];
 if(!Array.isArray(sessions))throw Error('switch_sessions_invalid');
 for(const raw of sessions){
  const session=assertReturnedBinding(raw,bindingId),id=session.session_id||session.usage_id||session.id,current=link.fresh();
  if(current&&current.binding_id===bindingId&&current.session_id===id)await client.query('SELECT public.switch_resolve_session($1::uuid,$2::jsonb)',[id,JSON.stringify(publicSwitchSnapshot(current))]);
 }
}
