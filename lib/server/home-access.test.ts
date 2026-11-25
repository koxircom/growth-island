import {afterEach,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {openHomeAccess} from './home-access';
const dirs:string[]=[];const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))));for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});
async function bridge(body:string,code=200){
 const dir=mkdtempSync(join(tmpdir(),'home-access-'));dirs.push(dir);const path=join(dir,'bridge.sock');
 const server=createServer((req,res)=>{expect(req.method).toBe('POST');expect(req.url).toBe('/open');res.writeHead(code,{'content-type':'application/json'});res.end(body);});servers.push(server);
 await new Promise<void>(r=>server.listen(path,r));return path;
}
describe('home access bridge',()=>{
 it('returns only independently confirmed device results',async()=>{
  const path=await bridge(JSON.stringify({network:'open',dlna:'unknown',extra:'ignored'}));
  expect(await openHomeAccess(path)).toEqual({network:'open',dlna:'unknown'});
 });
 it('speaks the fixed protocol to the Python bridge using synthetic devices',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'home-access-e2e-'));dirs.push(dir);const path=join(dir,'bridge.sock');
  const script="from bridge import UnixServer\nimport sys\nclass D:\n def read(self): return True\n def open(self): raise RuntimeError('unexpected')\ns=UnixServer(sys.argv[1],D(),D())\ns.serve_forever()";
  const child=spawn('python3',['-u','-c',script,path],{cwd:join(process.cwd(),'service/home-access'),stdio:'ignore'});
  try{
   for(let i=0;i<100&&!existsSync(path);i++)await new Promise(r=>setTimeout(r,20));
   expect(existsSync(path)).toBe(true);
   expect(await openHomeAccess(path)).toEqual({network:'open',dlna:'open'});
  }finally{child.kill('SIGTERM');await new Promise<void>(r=>child.once('exit',()=>r()));}
 });
 it('reports unavailable, invalid responses and missing configuration as unknown',async()=>{
  expect(await openHomeAccess('')).toEqual({network:'unknown',dlna:'unknown'});
  expect(await openHomeAccess(await bridge('not-json'))).toEqual({network:'unknown',dlna:'unknown'});
  expect(await openHomeAccess(await bridge('{"network":"open","dlna":"open"}',503))).toEqual({network:'unknown',dlna:'unknown'});
 });
});
