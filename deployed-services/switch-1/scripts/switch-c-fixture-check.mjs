import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifySwitchState} from './switch-state.mjs';
import {switchCommandHash,verifySwitchResult} from './switch-protocol.mjs';
import {createSwitchControl,verifySwitchControlResult} from './switch-control.mjs';
const fixture=JSON.parse(await readFile(new URL('../qa/fixtures/switch-driver.json',import.meta.url),'utf8'));
const data=fixture.trace.growth_allocation,key=Buffer.alloc(32,0x42),state=data.state;
test('real C/OpenSSL driver state HMAC is independently accepted by Node',()=>{
 assert.equal(fixture.exit,0);assert.equal(fixture.trace.synthetic,true);
 const result=verifySwitchState(JSON.stringify(state),key,{consoleId:'a123bcde',bindingId:'00000000-0000-4000-8000-000000000001',nowSeconds:state.observed_at});
 assert.equal(result.granted_seconds,1800);assert.equal(BigInt(result.consumed_ns)+BigInt(result.remaining_ns),1800000000000n);
});
test('C historical stop receipt binds the exact immutable Node command',()=>{
 const command={v:1,action:'stop',console_id:state.console_id,binding_id:state.binding_id,boot_id:state.boot_id,sequence:2,request_id:data.receipt.request_id,session_id:data.receipt.session_id,total_seconds:0,issued_at:1794571200,accept_before:1794571320,query_request_id:''};
 assert.equal(switchCommandHash(command),data.receipt.request_hash);
 const result=verifySwitchResult(JSON.stringify(data.receipt),key,command);assert.equal(result.phase,'applied');assert.equal(result.session_state,'ended');
});
test('C operator restore receipt binds the independent Node control canonical',()=>{
 const expected=createSwitchControl({console_id:state.console_id,binding_id:state.binding_id,action:'restore',request_id:data.control.request_id,boot_id:data.control.boot_id,accept_before:1794571320},key);
 assert.equal(expected.command_hash,data.control.command_hash);assert.equal(verifySwitchControlResult(data.control,expected,key).phase,'applied');
});
