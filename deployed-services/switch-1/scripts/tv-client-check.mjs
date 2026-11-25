import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createTvClient,TvOutcomeUnknown,signTvRequest} from './tv-client.mjs';
const secret='x'.repeat(32), uuid='12345678-1234-1234-1234-123456789abc';
function client(fetchImpl) {return createTvClient({baseUrl:'http://127.0.0.1:8880',secret,fetchImpl,now:()=>1700000000000});}
test('exact raw body signing',()=>{
 const body='{"seconds":60}';
 const expected=createHmac('sha256',secret).update('1700000000\nPOST\n/tv/api/v1/start\n'+createHash('sha256').update(body).digest('hex')).digest('hex');
 assert.equal(signTvRequest(secret,'1700000000','POST','/tv/api/v1/start',body),expected);
});
test('allowlisted payload, no redirect, same request id on retry',async()=>{
 const bodies=[];
 const c=client(async(url,options)=>{assert.equal(url.pathname,'/tv/api/v1/start');assert.equal(options.redirect,'error');bodies.push(options.body);const signature=createHmac('sha256',secret).update(options.headers['X-TV-Signature']+'\n200\n'+createHash('sha256').update('{}').digest('hex')).digest('hex');return new Response('{}',{headers:{'X-TV-Response-Signature':signature}});});
 const payload={usage_id:uuid,request_id:uuid,seconds:60,child_name:'private'};
 await c.execute('start',payload);await c.execute('start',payload);
 assert.equal(bodies[0],bodies[1]);assert.equal(bodies[0].includes('private'),false);
});
test('connection loss and HTTP rejection remain unknown',async()=>{
 for(const fetchImpl of [async()=>{throw new Error('secret');},async()=>new Response('{}',{status:409}),async()=>new Response('broken')]) {
 await assert.rejects(client(fetchImpl).execute('start',{usage_id:uuid,request_id:uuid,seconds:60}),TvOutcomeUnknown);
 }
});
test('invalid paths and duration blocked before network',async()=>{
 const c=client(()=>{throw new Error('network must not run');});
 assert.throws(()=>c.operation('../../etc'),/invalid_tv_operation_id/);
 assert.throws(()=>c.execute('start',{usage_id:uuid,request_id:uuid,seconds:0}),/invalid_tv_seconds/);
});

test('signed 404 permits lookup replay, forged 404 remains unknown',async()=>{
 const good=client(async(url,options)=>{
  const body='{"error":"not_found"}';
  const signature=createHmac('sha256',secret).update(options.headers['X-TV-Signature']+'\n404\n'+createHash('sha256').update(body).digest('hex')).digest('hex');
  return new Response(body,{status:404,headers:{'X-TV-Response-Signature':signature}});
 });
 assert.deepEqual(await good.operation(uuid),{found:false});
 await assert.rejects(client(async()=>new Response('{"error":"not_found"}',{status:404})).operation(uuid),TvOutcomeUnknown);
});
test('tampered signed body cannot authorize settlement',async()=>{
 const c=client(async(url,options)=>{
  const signature=createHmac('sha256',secret).update(options.headers['X-TV-Signature']+'\n200\n'+createHash('sha256').update('{"accepted":false}').digest('hex')).digest('hex');
  return new Response('{"accepted":true}',{headers:{'X-TV-Response-Signature':signature}});
 });
 await assert.rejects(c.operation(uuid),TvOutcomeUnknown);
});
