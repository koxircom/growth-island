import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({body:{parent_token:'a'.repeat(64)},user:{id:'parent'},deny:false,originDenied:false,call:vi.fn()}));
vi.mock('@/lib/server/auth',()=>({sessionUser:async()=>state.user,sessionToken:()=> 'b'.repeat(64),digest:()=> 'hash'}));
vi.mock('@/lib/server/db',()=>({transaction:async(fn:any)=>fn({query:async(sql:string)=>{if(sql.includes('get_switch_operations')&&state.deny)throw Error('parent_required');return {rows:[]}}})}));
vi.mock('@/lib/server/home-access',()=>({openHomeAccess:()=>state.call()}));
vi.mock('@/lib/server/http',()=>({
 HttpError:class extends Error{constructor(public status:number,message:string){super(message)}},
 readBody:async()=>{if(state.originDenied)throw Error('origin_not_allowed');return state.body},
 json:(x:unknown,status=200)=>new Response(JSON.stringify(x),{status}),
 failure:()=>new Response('{}',{status:503}),
}));
import {POST} from '../app/api/parent/home-access/route';
beforeEach(()=>{state.body={parent_token:'a'.repeat(64)};state.user={id:'parent'};state.deny=false;state.originDenied=false;state.call.mockReset().mockResolvedValue({network:'open',dlna:'unknown'});});
describe('parent-only home access',()=>{
 it('rejects missing parent capability before reaching the bridge',async()=>{state.body={parent_token:''};const r=await POST({} as any);expect(r.status).toBe(403);expect(state.call).not.toHaveBeenCalled()});
 it('rejects absent login and expired parent access without touching devices',async()=>{state.user=null as any;await POST({} as any);expect(state.call).not.toHaveBeenCalled();state.user={id:'parent'};state.deny=true;const r=await POST({} as any);expect(r.status).toBe(403);expect(state.call).not.toHaveBeenCalled()});
 it('rejects requests that fail the origin check',async()=>{state.originDenied=true;await POST({} as any);expect(state.call).not.toHaveBeenCalled()});
 it('calls the bridge only after parent authorization',async()=>{const r=await POST({} as any);expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{network:'open',dlna:'unknown'}});expect(state.call).toHaveBeenCalledOnce()});
});
