import {request} from 'node:http';

// The socket is supplied by the deployment, never by an operation payload.
export async function requireHomeAccess(socketPath=process.env.HOME_ACCESS_SOCKET) {
 if(!socketPath?.startsWith('/'))throw Error('home_access_unavailable');
 const result=await new Promise((resolve,reject)=>{
  const req=request({socketPath,path:'/open',method:'POST',headers:{'content-type':'application/json'},timeout:45000},res=>{
   let raw='',size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>4096)req.destroy(Error('home_access_invalid'));else raw+=chunk;});
   res.on('end',()=>{try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(raw));}catch{reject(Error('home_access_invalid'));}});
   res.on('error',reject);
  });
  req.on('timeout',()=>req.destroy(Error('home_access_timeout')));
  req.on('error',reject);req.end('{}');
 });
 if(result?.network!=='open'||result?.dlna!=='open')throw Error('home_access_unconfirmed');
}
