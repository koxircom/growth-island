import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

/** A failure here never authorizes refund: the remote operation may have committed. */
export class TvOutcomeUnknown extends Error {
  constructor() { super('tv_outcome_unknown'); this.name='TvOutcomeUnknown'; }
}
export function signTvRequest(secret, timestamp, method, path, body='') {
  const digest=createHash('sha256').update(body).digest('hex');
  return createHmac('sha256',secret).update(`${timestamp}\n${method}\n${path}\n${digest}`).digest('hex');
}
export function createTvClient({baseUrl, secret, fetchImpl=fetch, timeoutMs=5000, now=Date.now}) {
  const base=new URL(baseUrl);
  if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('invalid_tv_endpoint');
  if (!secret || Buffer.byteLength(secret)<32) throw new Error('invalid_tv_key');
  // Destination is deployment configuration, never user-controlled request input.
  async function request(method, suffix, payload) {
    const path=`/tv/api/v1/${suffix}`;
    const body=payload===undefined?'':JSON.stringify(payload);
    const timestamp=String(Math.floor(now()/1000));
    const requestSignature=signTvRequest(secret,timestamp,method,path.replace('/tv/api/', '/api/'),body);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(new URL(path,base), {
        method, redirect:'error', signal:controller.signal,
        headers:{'Content-Type':'application/json','X-TV-Timestamp':timestamp,'X-TV-Signature':requestSignature},
        ...(method==='GET'?{}:{body}),
      });
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length>65536) throw new TvOutcomeUnknown();
      const signature=response.headers.get('X-TV-Response-Signature')??'';
      const expected=createHmac('sha256',secret).update(`${requestSignature}\n${response.status}\n${createHash('sha256').update(bytes).digest('hex')}`).digest();
      if(!/^[a-f0-9]{64}$/i.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),expected)) throw new TvOutcomeUnknown();
      if(response.status===404 && method==='GET' && suffix.startsWith('operations/')) return {found:false};
      if(!response.ok) throw new TvOutcomeUnknown();
      const text=bytes.toString('utf8');
      const result=JSON.parse(text);
      if (!result || typeof result!=='object' || Array.isArray(result)) throw new TvOutcomeUnknown();
      return result;
    } catch { throw new TvOutcomeUnknown(); }
    finally { clearTimeout(timer); }
  }
  function id(value) {
    if(typeof value!=='string'||! /^[0-9a-f-]{36}$/i.test(value)) throw new Error('invalid_tv_operation_id');
    return value;
  }
  return {
    status:()=>request('GET','status'),
    config:()=>request('GET','config'),
    configure:payload=>request('POST','config',payload),
    operation:requestId=>request('GET',`operations/${id(requestId)}`),
    session:usageId=>request('GET',`sessions/${id(usageId)}`),
    execute:(action,payload)=>{
      if(!['start','extend','stop'].includes(action)) throw new Error('invalid_tv_action');
      id(payload.request_id); id(payload.usage_id);
      if(action!=='stop'&&(!Number.isSafeInteger(payload.seconds)||payload.seconds<=0||payload.seconds>10800)) throw new Error('invalid_tv_seconds');
      // Explicit allowlist prevents accidental transmission of child or family data.
      return request('POST',action,{request_id:payload.request_id,usage_id:payload.usage_id,...(action==='stop'?{}:{seconds:payload.seconds})});
    },
  };
}


