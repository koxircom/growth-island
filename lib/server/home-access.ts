import {request} from 'node:http';

type State = 'open' | 'unknown';
export type HomeAccessResult = {network: State; dlna: State};
const unavailable: HomeAccessResult = {network:'unknown',dlna:'unknown'};

/** The path is deployment configuration, never input from the browser. */
export async function openHomeAccess(socketPath = process.env.HOME_ACCESS_SOCKET): Promise<HomeAccessResult> {
 if (!socketPath || !socketPath.startsWith('/')) return unavailable;
 return new Promise(resolve => {
  let settled=false;
  const finish=(value:HomeAccessResult)=>{if(!settled){settled=true;resolve(value);}};
  const req=request({socketPath,path:'/open',method:'POST',headers:{'content-type':'application/json'},timeout:45000},res=>{
   const chunks:Buffer[]=[];let bytes=0;
   res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>4096){req.destroy();finish(unavailable);}else chunks.push(chunk);});
   res.on('end',()=>{try{
    if(res.statusCode!==200) return finish(unavailable);
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const network:State=value?.network==='open'?'open':'unknown';
    const dlna:State=value?.dlna==='open'?'open':'unknown';
    finish({network,dlna});
   }catch{finish(unavailable);}});
   res.on('error',()=>finish(unavailable));
  });
  req.on('timeout',()=>{req.destroy();finish(unavailable);});
  req.on('error',()=>finish(unavailable));
  req.end('{}');
 });
}
