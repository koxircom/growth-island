import {verifySwitchResult,switchCommandHash} from '../switch-protocol.mjs';
// Uses the existing worker DB/Link/key. Creates no MQTT or parallel publisher.
export function oneShotJournal(db,key){
 const journal={
 async current(id){return (await db.query('SELECT public.switch_test_current($1) v',[id])).rows[0]?.v;},
 async prepare(op,command,hash){await db.query('SELECT public.switch_test_prepare($1,$2,$3)',[op.request_id,command,hash]);},
 async dispatchOnce(op,hash){return (await db.query('SELECT public.switch_test_dispatch_once($1,$2) v',[op.request_id,hash])).rows[0]?.v;},
 async unknown(op){await db.query('SELECT public.switch_test_unknown($1)',[op.request_id]);},
 async observe(op,ignoredNormalized,wire){
  const current=await journal.current(op.request_id);
  if(!current?.command||current.console_id!==op.console_id||current.binding_id!==op.binding_id||current.usage_id!==op.usage_id)throw Error('journal_identity_changed');
  // Re-verify raw signed receipt rather than accepting a caller boolean or normalized JSON.
  verifySwitchResult(wire,key,current.command);
  await db.query('SELECT public.switch_test_receipt($1,$2,$3)',[op.request_id,switchCommandHash(current.command),wire]);
 }
 };return journal;
}
