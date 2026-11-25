// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ParentTvSettings} from '../app/parent-tv-settings';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>|null=null;
afterEach(()=>{if(root)act(()=>root?.unmount());root=null;vi.unstubAllGlobals();document.body.innerHTML='';});
describe('parent home access action',()=>{
 it('sends the parent capability once and shows partial confirmation',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{network:'open',dlna:'unknown'}})});vi.stubGlobal('fetch',fetch);
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<ParentTvSettings data={{devices:[]} as any} token={'a'.repeat(64)} busy={false} mutate={async()=>null}/>));
  const button=[...container.querySelectorAll('button')].find(x=>x.textContent?.includes('一键开启电视网络和 DLNA'))!;
  expect(button).toBeTruthy();await act(async()=>button.click());
  expect(fetch).toHaveBeenCalledOnce();const [url,init]=fetch.mock.calls[0];expect(url).toBe('/api/parent/home-access');expect(JSON.parse(init.body)).toEqual({parent_token:'a'.repeat(64)});
  expect(container.textContent).toContain('电视网络：规则已放行；DLNA：未确认');
 });
});
