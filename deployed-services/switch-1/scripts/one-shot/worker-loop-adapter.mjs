import {runOneShot} from './worker-adapter.mjs';
const flights=new WeakMap();
function exclusive(options,kind,work){
 const owner=options.transactionOwner;
 if(!owner||typeof owner!=='object')throw Error('transaction_owner_required');
 const prior=flights.get(owner);
 if(prior){
  if(prior.kind===kind&&prior.requestId===options.requestId&&prior.link===options.link&&prior.journal===options.journal&&prior.normal===options.normal&&prior.selector===options.selectRequestId)
   return prior.promise;
  return Promise.resolve({handled:false,blocksNormal:true,status:'worker_busy'});
 }
 const record={kind,requestId:options.requestId,link:options.link,journal:options.journal,normal:options.normal,selector:options.selectRequestId};
 record.promise=Promise.resolve().then(work).finally(()=>{if(flights.get(owner)===record)flights.delete(owner);});
 flights.set(owner,record);return record.promise;
}
export function tickOneShot(options){return exclusive(options,'tick',()=>runTick(options));}
// Production mainloop must route BOTH test and normal DB work through this owner.
// normal() includes its status/claim/prepare transactions; never call it outside.
export function runWorkerCycle(options){
 if(typeof options.normal!=='function')throw Error('normal_callback_required');
 return exclusive(options,'cycle',async()=>{
  if(options.cancelled?.())return {handled:false,blocksNormal:true,status:'stopping'};
  const result=await runTick(options);
  if(result.blocksNormal)return result;
  if(options.cancelled?.())return {handled:false,blocksNormal:true,status:'stopping'};
  await options.normal();
  return {...result,normalRan:true};
 });
}
async function runTick({journal,link,requestId,selectRequestId,recordVerified,updateStatus,wait,cancelled=()=>false}){
 if(cancelled())return {handled:false,blocksNormal:true,status:'stopping'};
 if(selectRequestId)requestId=await selectRequestId();
 const op=await journal.current(requestId);
 if(!op)return {handled:false,blocksNormal:false};
 const snapshot=link.last;
 const state=link.fresh();
 if(snapshot!==link.last)throw Error('snapshot_changed');
 if(state&&snapshot?.state!==state)throw Error('snapshot_pair_mismatch');
 if(state&&state.session_id===op.usage_id&&state.sequence===op.sequence){
  if(typeof snapshot.rawWire!=='string')throw Error('signed_state_wire_missing');
  await recordVerified(requestId,snapshot.rawWire);
  await updateStatus(state);
  const after=await journal.current(requestId);
  if(after?.phase==='closed')return {handled:true,blocksNormal:false,status:'terminal_verified'};
 }
 if(op.phase==='closed')return {handled:true,blocksNormal:false,status:'closed'};
 const result=await runOneShot(journal,link,{request_id:requestId},{wait,cancelled});
 return {handled:true,blocksNormal:true,status:result};
}
