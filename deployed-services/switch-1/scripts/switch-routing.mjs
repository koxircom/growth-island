// The database is shared by all Switch workers. Every worker-side queue read
// must carry the binding selected by its config; there is deliberately no
// compatibility fallback to the historical unfiltered RPCs.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function requireSwitchBindingId(source){
 let bindingId;
 if(typeof source==='string')bindingId=source;
 else if(source&&Object.prototype.hasOwnProperty.call(source,'binding_id'))bindingId=source.binding_id;
 else bindingId=source?.config?.binding_id;
 if(typeof bindingId!=='string'||!UUID.test(bindingId))throw Error('switch_binding_required');
 return bindingId;
}

export function claimOperationQuery(source){
 const bindingId=requireSwitchBindingId(source);
 return {sql:'SELECT public.switch_claim_operation_for($1::uuid) AS operation',params:[bindingId]};
}

export function sessionsToPollQuery(source){
 const bindingId=requireSwitchBindingId(source);
 return {sql:'SELECT public.switch_sessions_to_poll_for($1::uuid) AS sessions',params:[bindingId]};
}

export function assertReturnedBinding(value,bindingId){
 if(value!==null&&value!==undefined&&(!value || typeof value!=='object'||value.binding_id!==bindingId))throw Error('switch_binding_mismatch');
 return value;
}
