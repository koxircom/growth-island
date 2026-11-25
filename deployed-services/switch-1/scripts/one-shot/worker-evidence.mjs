// No transport. The caller supplies a dedicated trusted verifier DB connection.
// Browser roles receive no access. Every record first passes actual HMAC verification.
import {terminalEvidence} from './terminal-evidence.mjs';
export async function recordEvidence(db,id,wire,key,{nowSeconds}={}){
 await db.query('BEGIN');
 try{
  const row=(await db.query('SELECT public.switch_test_evidence_context($1) v',[id])).rows[0]?.v;
  if(!row)throw Error('missing');
  // Exact retry after commit response loss: re-verify MAC/freshness first.
  const duplicate=row.terminal_wire===wire;
  const op={request_id:row.id,usage_id:row.request_id,binding_id:row.binding,console_id:row.console_id,sequence:Number(row.sequence),command:row.command,command_hash:row.hash,phase:(duplicate||row.phase==='resolved')?'active':row.phase};
  const evidence=terminalEvidence(wire,key,op,duplicate?null:row.terminal_state,{nowSeconds,allowActive:true});
  const n=(await db.query('SELECT public.switch_test_record_verified($1,$2,$3,$4) n',[id,row.evidence_revision,evidence.raw,evidence.state])).rows[0].n;
  await db.query('COMMIT');return {revision:n,mayRelease:evidence.mayRelease};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
