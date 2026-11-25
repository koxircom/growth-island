import {runWorkerCycle} from './worker-loop-adapter.mjs';
import {oneShotJournal} from './worker-journal.mjs';
import {recordEvidence} from './worker-evidence.mjs';
import {publicSwitchSnapshot} from '../switch-state.mjs';
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
 const normal=async()=>{
  if(cancelled())return;
  const fresh=link.fresh();if(!fresh)return;
  await updateStatus(fresh);
  if(cancelled())return;
  const claimed=switchCanClaim(fresh)?(await client.query('SELECT public.switch_claim_operation() AS operation')).rows[0]?.operation:null;
  if(claimed&&!cancelled())await reconcileSwitchOperation(client,link,claimed,{wait,cancelled});
  const sessions=(await client.query('SELECT public.switch_sessions_to_poll() AS sessions')).rows[0]?.sessions||[];
  for(const session of sessions){const id=session.session_id||session.usage_id||session.id,current=link.fresh();if(current&&current.session_id===id)await client.query('SELECT public.switch_resolve_session($1::uuid,$2::jsonb)',[id,JSON.stringify(publicSwitchSnapshot(current))]);}
 };
 const selectRequestId=async()=> (await client.query('SELECT public.switch_test_select_request($1) id',[link.fresh()?.session_id||''])).rows[0]?.id;
 const options={transactionOwner:client,journal,link,normal,selectRequestId,wait,cancelled,
 recordVerified:(id,wire)=>recordEvidence(client,id,wire,link.key),updateStatus};
 return {tick:()=>runWorkerCycle(options)};
}
