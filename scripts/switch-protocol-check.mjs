import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSwitchCommand,switchCommandHash,signSwitchCommand,verifySwitchCommand,canAcceptNewSwitchCommand,signSwitchResult,verifySwitchResult} from './switch-protocol.mjs';
const key=Buffer.alloc(32,0x42),other=Buffer.alloc(32,0x24);
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const start=()=>({v:1,action:'start',console_id:'a123bcde',binding_id:uuid(1),boot_id:uuid(2),sequence:1,request_id:uuid(3),session_id:uuid(4),total_seconds:1800,issued_at:1000,accept_before:1060,query_request_id:''});
const state=()=>({consoleId:'a123bcde',bindingId:uuid(1),bootId:uuid(2),clockTrusted:true,nowSeconds:1010});
const receipt=c=>({v:1,action:c.action,console_id:c.console_id,binding_id:c.binding_id,request_id:c.request_id,session_id:c.session_id,sequence:c.sequence,request_hash:switchCommandHash(c),phase:'applied',session_state:'paused',granted_seconds:c.total_seconds,consumed_ns:'0',remaining_ns:String(BigInt(c.total_seconds)*1000000000n),reason:'ok'});

test('command authentication is deterministic and exact',()=>{
 const c=start(),wire=signSwitchCommand(c,key);assert.deepEqual(verifySwitchCommand(wire,key),c);
 assert.equal(signSwitchCommand({...c},key),wire);assert.throws(()=>verifySwitchCommand(wire,other));
 assert.equal(canonicalSwitchCommand(c).toString().split('\n')[0],'GI-SWITCH-COMMAND/1');
});
test('wrong parameters cannot reuse the original signature',()=>{
 const signed=JSON.parse(signSwitchCommand(start(),key));
 for(const [k,v] of [['total_seconds',3600],['console_id','b123bcde'],['sequence',2],['request_id',uuid(5)],['boot_id',uuid(6)]]){
  assert.throws(()=>verifySwitchCommand(JSON.stringify({...signed,[k]:v}),key));
 }
});
test('reject unknown fields, noninteger values, bounds and canonical injection',()=>{
 for(const mutation of [{extra:1},{total_seconds:0},{total_seconds:10801},{total_seconds:60.5},{sequence:0},{sequence:Number.MAX_SAFE_INTEGER+1},
  {console_id:'a123bcde\nextra'},{console_id:12345678},{request_id:uuid(3).toUpperCase().replace('4000','F000')},{issued_at:-1},{accept_before:1200},{accept_before:1000},{query_request_id:uuid(7)}]){
  assert.throws(()=>signSwitchCommand({...start(),...mutation},key));
 }
 assert.throws(()=>verifySwitchCommand('{}',key));assert.throws(()=>verifySwitchCommand('x'.repeat(2049),key));
 assert.throws(()=>signSwitchCommand(start(),Buffer.alloc(31)));
});
test('query is authenticated but never encodes additive credit',()=>{
 const q={...start(),action:'query',sequence:0,total_seconds:0,query_request_id:uuid(3),request_id:uuid(9)};
 assert.deepEqual(verifySwitchCommand(signSwitchCommand(q,key),key),q);
 assert.throws(()=>signSwitchCommand({...q,total_seconds:1},key));
});
test('new commands require trusted identity, boot, clock and deadline',()=>{
 assert.equal(canAcceptNewSwitchCommand(start(),state()).accepted,true);
 for(const [mutation,reason] of [[{consoleId:'b123bcde'},'conflict'],[{bindingId:uuid(8)},'conflict'],[{bootId:uuid(9)},'stale_boot'],
  [{clockTrusted:false},'clock_untrusted'],[{nowSeconds:1060},'expired'],[{nowSeconds:900},'clock_untrusted']]){
  assert.equal(canAcceptNewSwitchCommand(start(),{...state(),...mutation}).reason,reason);
 }
 // A persisted result can still be authenticated after the admission window.
 const c=start();assert.equal(verifySwitchResult(signSwitchResult(receipt(c),key),key,c).phase,'applied');
});
test('receipt binds request identity, exact immutable parameters and console',()=>{
 const c=start(),wire=signSwitchResult(receipt(c),key);assert.equal(verifySwitchResult(wire,key,c).remaining_ns,'1800000000000');
 assert.throws(()=>verifySwitchResult(wire,other,c));
 assert.throws(()=>verifySwitchResult(wire,key,{...c,total_seconds:3600}));
 assert.throws(()=>verifySwitchResult(wire,key,{...c,request_id:uuid(8)}));
 const wrongBudget={...receipt(c),granted_seconds:3600,remaining_ns:'3600000000000'};
 assert.throws(()=>verifySwitchResult(signSwitchResult(wrongBudget,key),key,c));
 assert.throws(()=>verifySwitchResult(signSwitchResult({...receipt(c),session_state:'unknown'},key),key,c));
});
test('receipts preserve exact nanoseconds and refuse impossible budgets',()=>{
 const c=start(),r={...receipt(c),consumed_ns:'1000000001',remaining_ns:'1798999999999'};
 assert.equal(verifySwitchResult(signSwitchResult(r,key),key,c).consumed_ns,'1000000001');
 for(const mutation of [{remaining_ns:'1800000000000'},{consumed_ns:'-1'},{consumed_ns:'01'},{granted_seconds:10801},
  {phase:'success'},{phase:'applied',reason:'unknown'},{session_state:'exhausted'},{request_hash:'bad'},{reason:'untrusted free text'}]){
  assert.throws(()=>signSwitchResult({...r,...mutation},key));
 }
});
test('stop results require an ended state; terminal status is not a broker ACK',()=>{
 const c={...start(),action:'stop',total_seconds:0};const r={...receipt(c),session_state:'ended'};
 assert.equal(verifySwitchResult(signSwitchResult(r,key),key,c).session_state,'ended');
 assert.throws(()=>signSwitchResult({...r,session_state:'playing'},key));
 for(const phase of ['prepared','unknown']){
  const result={...r,phase,reason:'unknown',session_state:'unknown'};
  assert.equal(verifySwitchResult(signSwitchResult(result,key),key,c).phase,phase);
 }
});
