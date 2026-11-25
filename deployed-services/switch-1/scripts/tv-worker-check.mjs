import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOperation} from './tv-worker.mjs';
const request_id='12345678-1234-1234-1234-123456789abc';
const operation={request_id,action:'start',payload:{request_id,usage_id:request_id,seconds:60}};
test('recovery uses stored result without another start',async()=>{
 let calls=0;
 const db={query:async()=>calls++};
 await reconcileOperation(db,{operation:async()=>({request_id,accepted:true,operation_status:'applied'}),execute:()=>{throw new Error('duplicate start');}},operation);
 assert.equal(calls,1);
});
test('missing operation replays identical payload',async()=>{
 let saved;
 await reconcileOperation({query:async(...args)=>saved=args},{operation:async()=>({found:false}),execute:async(action,payload)=>{assert.equal(payload,operation.payload);return {request_id,accepted:false,operation_status:'rejected'};}},operation);
 assert.equal(saved[1][0],request_id);
});
test('timeout never calls database resolution',async()=>{
 let writes=0;
 await assert.rejects(reconcileOperation({query:async()=>writes++},{operation:async()=>{throw new Error('timeout');}},operation));
 assert.equal(writes,0);
});
test('wrong response id never resolves',async()=>{
 let writes=0;
 await assert.rejects(reconcileOperation({query:async()=>writes++},{operation:async()=>({request_id:'wrong',accepted:true,operation_status:'applied'})},operation));
 assert.equal(writes,0);
});

