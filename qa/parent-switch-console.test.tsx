// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {ParentSwitchStatus} from '../app/parent-switch-status';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});

it('selects actual consoles while showing their shared ledger, never TV as a console',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{read_at:'2026-11-23T00:00:00Z',devices:[{id:'tv',name:'电视',active:true},{id:'ledger',name:'Switch',active:true}],children:[{id:'child',nickname:'孩子'}],balances:[{child_id:'child',device_id:'ledger',seconds:600}],redemptions:[],usage:[]}})}));
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
 const dashboard={switch_consoles:[{binding_id:'one',device_id:'ledger',label:'Switch 1',enabled:true,online:false},{binding_id:'two',device_id:'ledger',label:'Switch 2',enabled:true,online:false}]};
 await act(async()=>root.render(<ParentSwitchStatus token="parent" timezone="Asia/Shanghai" dashboard={dashboard as any}/>));
 const select=el.querySelector('select')!;
 expect([...select.options].map(o=>o.textContent)).toEqual(['请选择主机','Switch 1','Switch 2']);
 await act(async()=>{select.value='two';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(el.textContent).toContain('孩子：10 分钟');
 expect(el.textContent).toContain('共享时间账本');
 await act(async()=>root.unmount());
});
