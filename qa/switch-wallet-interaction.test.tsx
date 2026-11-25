// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SwitchWallet} from '../app/switch-wallet';
import type {Child,Dashboard} from '../lib/model';
vi.mock('@/lib/child-voice',()=>({speakChildFeedback:vi.fn(),speakChildExplanation:vi.fn(),stopChildFeedback:vi.fn(),subscribeChildVoice:()=>()=>{},getChildVoiceState:()=>({settings:{enabled:false,volume:1},message:'',status:''})}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>|null=null;
afterEach(()=>{if(root)act(()=>root?.unmount());root=null;document.body.innerHTML='';});
describe('offline Switch console selection',()=>{
 it('does not imply a pending request was already delivered to the host',async()=>{
  const child={id:'child-a',nickname:'小朋友A'} as Child;
  const data={switch_settings:{enabled:true,device_id:'device',binding_id:'switch-1'},devices:[{id:'device',name:'Switch',active:true}],switch_consoles:[{binding_id:'switch-1',label:'Switch 1',enabled:true,online:false}],switch_sessions:[{id:'session-a',child_id:'child-a',device_id:'device',binding_id:'switch-1',state:'pending',granted_seconds:0,consumed_seconds:0,pending:true}],children:[child],device_time_balances:[{child_id:'child-a',device_id:'device',balance_seconds:0}],redemptions:[]} as unknown as Dashboard;
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<SwitchWallet data={data} child={child} busy={false} mutate={vi.fn()}/>));
  expect(container.textContent).toContain('可能仍在等待发送或主机回执');
  expect(container.textContent).toContain('尚未确认生效');
 });
 it('keeps an occupied host isolated while allowing another host to receive an offline queue',async()=>{
  const child={id:'child-b',nickname:'小朋友B'} as Child;
  const data={switch_settings:{enabled:true,device_id:'device',binding_id:'switch-1'},devices:[{id:'device',name:'Switch',active:true}],switch_consoles:[{binding_id:'switch-1',label:'Switch 1',enabled:true,online:false},{binding_id:'switch-2',label:'Switch 2',enabled:true,online:false}],switch_sessions:[{id:'session-a',child_id:'child-a',device_id:'device',binding_id:'switch-1',state:'pending',granted_seconds:0,consumed_seconds:0,pending:true}],children:[{id:'child-a',nickname:'小朋友A'},child],device_time_balances:[{child_id:'child-b',device_id:'device',balance_seconds:300}],redemptions:[]} as unknown as Dashboard;
  const mutate=vi.fn().mockResolvedValue({ok:true});const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<SwitchWallet data={data} child={child} busy={false} mutate={mutate}/>));
  const selector=container.querySelector('select[aria-label="小朋友B选择Switch主机"]') as HTMLSelectElement;
  expect(selector).not.toBeNull();
  await act(async()=>{selector.value='switch-1';selector.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('正在由 小朋友A 使用');expect(container.contains(selector)).toBe(true);expect(mutate).not.toHaveBeenCalled();
  await act(async()=>{selector.value='switch-2';selector.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).not.toContain('正在由 小朋友A 使用');
  const start=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('开始使用'))!;
  expect(start.getAttribute('aria-disabled')).toBe('false');
  await act(async()=>start.click());
  expect(container.textContent).toContain('点亮联网并确认后生效');
  const confirm=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('确认发送'))!;
  await act(async()=>confirm.click());
  expect(mutate).toHaveBeenCalledExactlyOnceWith('device_time_start',{child_id:'child-b',device_id:'device',binding_id:'switch-2',seconds:300});
 });
});
