import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signSwitchState,verifySwitchState,publicSwitchSnapshot} from './switch-state.mjs';
import {signSwitchResult,switchCommandHash} from './switch-protocol.mjs';
import {SwitchLink,reconcileSwitchOperation,switchCanClaim} from './switch-worker.mjs';
import {SwitchMqtt} from './switch-mqtt.mjs';
import {createSwitchControl,verifySwitchControlResult} from './switch-control.mjs';
import {createHmac} from 'node:crypto';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key=Buffer.alloc(32,0x42),config={key_hex:key.toString('hex'),console_id:'5698b11b',binding_id:uuid(1),stateTopic:'state',commandTopic:'set'};
function state(overrides={}){return {v:1,console_id:config.console_id,binding_id:config.binding_id,boot_id:uuid(2),sample_sequence:1,observed_at:Math.floor(Date.now()/1000),session_id:'',session_state:'none',granted_seconds:0,consumed_ns:'0',remaining_ns:'0',clock_trusted:true,native_verified:true,sequence:0,reason:'ok',...overrides};}
function envelope(s,receipt=null){return {topic:'state',retained:false,payload:JSON.stringify({source:'agent',console:{emummc:true,firmware:'21.2.0'},growth_allocation:{state:JSON.parse(signSwitchState(s,key)),receipt}})};}
function operation(){return {request_id:uuid(3),usage_id:uuid(4),console_id:config.console_id,binding_id:config.binding_id,action:'start',seconds:1800,total_seconds:1800,sequence:1,command:null,command_hash:null};}
function applied(c){return {v:1,action:c.action,console_id:c.console_id,binding_id:c.binding_id,request_id:c.request_id,session_id:c.session_id,sequence:c.sequence,request_hash:switchCommandHash(c),phase:'applied',session_state:'playing',granted_seconds:c.total_seconds,consumed_ns:'0',remaining_ns:String(BigInt(c.total_seconds)*1000000000n),reason:'ok'};}
test('signed state requires exact identity, freshness, conservation and HMAC',()=>{
 const s=state(),wire=signSwitchState(s,key),options={consoleId:config.console_id,bindingId:config.binding_id};
 assert.deepEqual(verifySwitchState(wire,key,options),s);
 assert.throws(()=>verifySwitchState(wire,Buffer.alloc(32,0x24),options));
 assert.throws(()=>verifySwitchState(wire,key,{...options,consoleId:'00000000'}));
 assert.throws(()=>verifySwitchState(wire,key,{...options,nowSeconds:s.observed_at+31}));
 assert.throws(()=>signSwitchState({...s,remaining_ns:'1'},key));
 assert.throws(()=>signSwitchState({...s,extra:true},key));
 assert.equal(publicSwitchSnapshot(state({session_id:uuid(4),session_state:'paused',granted_seconds:1,consumed_ns:'1',remaining_ns:'999999999'})).consumed_seconds,1);
});
test('only fresh non-retained emu firmware packets advance current state',()=>{
 const link=new SwitchLink(config,{publish(){}}),s=state();
 assert.equal(link.receive({...envelope(s),retained:true}),false);
 const wrong=envelope(s),e=JSON.parse(wrong.payload);e.console.emummc=false;wrong.payload=JSON.stringify(e);assert.equal(link.receive(wrong),false);
 assert.equal(link.receive(envelope(s)),true);assert.equal(link.receive(envelope(s)),false);
 assert.equal(link.receive(envelope({...s,sample_sequence:2})),true);
 link.last.received-=16000;assert.equal(link.fresh(),null);
});
test('prepare is durable before query/send; correlated applied receipt resolves',async()=>{
 const events=[],op=operation();let command,result;
 const db={async query(sql,params){events.push(sql.includes('prepare')?'prepare':'resolve');if(sql.includes('prepare')){command=JSON.parse(params[1]);assert.equal(params[2],switchCommandHash(command));}else assert.equal(JSON.parse(params[1]).phase,'applied');}};
 const link={config,fresh:()=>state(),result:()=>result,query:c=>{events.push('query');assert.deepEqual(c,command);},execute:c=>{events.push('send');result=applied(c);}};
 assert.equal(await reconcileSwitchOperation(db,link,op,{wait:async()=>{}}),'applied');assert.deepEqual(events,['prepare','query','send','resolve']);
});
test('failed durable preparation publishes no command',async()=>{
 let sent=0;const db={async query(){throw Error('disk');}},link={config,fresh:()=>state(),query(){sent++;},execute(){sent++;}};
 await assert.rejects(()=>reconcileSwitchOperation(db,link,operation(),{wait:async()=>{}}));assert.equal(sent,0);
});
test('restart queries original immutable identity and does not reset cumulative topup',async()=>{
 const op=operation(),command={v:1,action:'extend',console_id:config.console_id,binding_id:config.binding_id,boot_id:uuid(2),sequence:2,request_id:uuid(5),session_id:uuid(4),total_seconds:3600,issued_at:100,accept_before:190,query_request_id:''};
 Object.assign(op,{request_id:uuid(5),action:'extend',sequence:2,total_seconds:3600,command,command_hash:switchCommandHash(command)});
 const events=[];let result;
 const link={config,fresh:()=>state({boot_id:uuid(8)}),result:()=>result,query:c=>{events.push('query');assert.equal(c.boot_id,uuid(2));result={...applied(c),consumed_ns:'1080000000000',remaining_ns:'2520000000000'};},execute:()=>{throw Error('must query first');}};
 const db={async query(sql,params){assert(sql.includes('resolve'));events.push('resolve');assert.equal(JSON.parse(params[1]).remaining_ns,'2520000000000');}};
 assert.equal(await reconcileSwitchOperation(db,link,op,{wait:async()=>{}}),'applied');assert.deepEqual(events,['query','resolve']);
});
test('lost reply only replays identical durable request and never refunds on silence',async()=>{
 const op=operation();let command;let prepares=0,executes=0,resolves=0;
 const db={async query(sql,p){if(sql.includes('prepare')){prepares++;command=JSON.parse(p[1]);}else resolves++;}};
 const link={config,fresh:()=>state(),result:()=>null,query(){},execute:c=>{executes++;assert.deepEqual(c,command);}};
 assert.equal(await reconcileSwitchOperation(db,link,op,{wait:async()=>{}}),'unknown');
 op.command=command;op.command_hash=switchCommandHash(command);
 assert.equal(await reconcileSwitchOperation(db,link,op,{wait:async()=>{}}),'unknown');
 assert.equal(prepares,1);assert.equal(executes,2);assert.equal(resolves,0);
});
test('existing unknown result stays unknown; not-ready grants publish nothing',async()=>{
 const op=operation();let calls=0;const notReady={config,fresh:()=>state({native_verified:false})};
 assert.equal(await reconcileSwitchOperation({query(){calls++;}},notReady,op),'not_ready');assert.equal(calls,0);
 assert.equal(await reconcileSwitchOperation({query(){calls++;}},{config,fresh:()=>state({session_state:'unknown'})},op),'not_ready');assert.equal(calls,0);
 const offline={config,fresh:()=>null};assert.equal(await reconcileSwitchOperation({},offline,op),'offline');
});
test('queued request waits for fresh matching sequence and physical session',async()=>{
 const op=operation();let calls=0;const db={query(){calls++;}},link=s=>({config,fresh:()=>s,query(){calls++;},execute(){calls++;}});
 assert.equal(await reconcileSwitchOperation(db,link(null),op),'offline');
 assert.equal(await reconcileSwitchOperation(db,link(state({sequence:1})),op),'state_conflict');
 assert.equal(await reconcileSwitchOperation(db,link(state({session_id:uuid(8),session_state:'playing',granted_seconds:1,remaining_ns:'1000000000'})),op),'state_conflict');
 const topup={...op,action:'extend',sequence:2,total_seconds:3600};
 assert.equal(await reconcileSwitchOperation(db,link(state({sequence:1,session_id:uuid(8),session_state:'playing',granted_seconds:1,remaining_ns:'1000000000'})),topup),'state_conflict');
 assert.equal(calls,0);
});
test('a new session can follow the known ended device session',async()=>{
 const op=operation();let command,result;const previous=uuid(12);
 const ended=state({session_id:previous,session_state:'ended',granted_seconds:60,consumed_ns:'60000000000',remaining_ns:'0'});
 const db={async query(sql,p){if(sql.includes('prepare'))command=JSON.parse(p[1]);else assert.equal(JSON.parse(p[1]).phase,'applied');}};
 const link={config,fresh:()=>ended,result:()=>result,query(){},execute:c=>{result=applied(c);}};
 assert.equal(await reconcileSwitchOperation(db,link,op,{wait:async()=>{}}),'applied');
 assert.equal(command.session_id,op.usage_id);
});
test('sleeping and unknown states do not consume a claim retry window',()=>{
 for(const session_state of ['sleeping','paused','unknown'])assert.equal(switchCanClaim(state({session_state})),false);
 assert.equal(switchCanClaim(null),false);assert.equal(switchCanClaim(state()),true);
});
test('signed sleeping state holds queued request until a verified wake',async()=>{
 const sleeping=state({session_state:'sleeping'}),wire=signSwitchState(sleeping,key);
 assert.deepEqual(verifySwitchState(wire,key,{consoleId:config.console_id,bindingId:config.binding_id}),sleeping);
 assert.throws(()=>signSwitchState({...sleeping,granted_seconds:1,remaining_ns:'1000000000'},key));
 let calls=0;const db={query(){calls++;}},link={config,fresh:()=>sleeping,query(){calls++;},execute(){calls++;}};
 assert.equal(await reconcileSwitchOperation(db,link,operation()),'not_ready');
 assert.equal(calls,0);
});
test('receipt verifies operation hash independently of surrounding heartbeat',()=>{
 const op=operation(),c={v:1,action:'start',console_id:op.console_id,binding_id:op.binding_id,boot_id:uuid(2),sequence:1,request_id:op.request_id,session_id:op.usage_id,total_seconds:1800,issued_at:100,accept_before:190,query_request_id:''};
 const link=new SwitchLink(config,{publish(){}}),receipt=JSON.parse(signSwitchResult(applied(c),key));
 assert(link.receive(envelope(state(),receipt)));assert.equal(link.result(c).phase,'applied');assert.equal(link.result({...c,total_seconds:3600}),null);
});
test('MQTT framing tolerates split packets, marks retained and ACKs only network delivery',()=>{
 const client=new SwitchMqtt({}),writes=[],messages=[];client.socket={write:b=>writes.push(b)};client.on('message',m=>messages.push(m));
 const payload=Buffer.from([0x33,7,0,1,0x74,0,7,0x7b,0x7d]);
 client.receive(payload.subarray(0,3));assert.equal(messages.length,0);client.receive(payload.subarray(3));
 assert.deepEqual(messages,[{topic:'t',retained:true,payload:'{}'}]);assert.equal(writes[0].toString('hex'),'40020007');
 assert.throws(()=>client.receive(Buffer.from([0x30,2,0,3])));
});
test('commissioning control has a separate authenticated domain and bounded actions',()=>{
 const expected=createSwitchControl({console_id:config.console_id,binding_id:config.binding_id,action:'arm',request_id:uuid(9),boot_id:uuid(2),accept_before:12345},key);
 assert(expected.wire.startsWith('GA1|arm|'));assert.throws(()=>createSwitchControl({...expected,action:'unlock'},key));
 const result={action:expected.action,request_id:expected.request_id,boot_id:expected.boot_id,command_hash:expected.command_hash,phase:'applied',reason:'ok'};
 const canonical='GI-SWITCH-CONTROL-RESULT/1\n'+[config.console_id,config.binding_id,result.action,result.request_id,result.boot_id,result.command_hash,result.phase,result.reason].join('\n')+'\n';
 result.mac=createHmac('sha256',key).update(canonical,'ascii').digest('hex');
 assert.equal(verifySwitchControlResult(result,expected,key).phase,'applied');
 assert.throws(()=>verifySwitchControlResult({...result,phase:'rejected'},expected,key));
});
