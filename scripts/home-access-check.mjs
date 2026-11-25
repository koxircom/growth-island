import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requireHomeAccess} from './home-access.mjs';

test('requires confirmed router and DLNA state over the configured socket',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'growth-home-'));
 const socket=join(dir,'bridge.sock');let state={network:'open',dlna:'open'};let calls=0;
 const server=createServer((req,res)=>{calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/open');res.end(JSON.stringify(state));});
 try{
  await new Promise(resolve=>server.listen(socket,resolve));
  await requireHomeAccess(socket);
  state={network:'open',dlna:'unknown'};
  await assert.rejects(requireHomeAccess(socket),/home_access_unconfirmed/);
  assert.equal(calls,2);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
 }
});
