import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SwitchWallet} from '../app/switch-wallet';
import type {Child,Dashboard} from '../lib/model';

describe('Switch console selection with an offline queue',()=>{
 it('lets another child choose a console without exposing the occupied console as available',()=>{
  const child={id:'child-b',nickname:'小朋友B'} as Child;
  const data={
   switch_settings:{enabled:true,device_id:'device',binding_id:'switch-1'},
   devices:[{id:'device',name:'Switch',active:true}],
   switch_consoles:[{binding_id:'switch-1',label:'Switch 1',enabled:true,online:false},{binding_id:'switch-2',label:'Switch 2',enabled:true,online:false}],
   switch_sessions:[{id:'session-a',child_id:'child-a',device_id:'device',binding_id:'switch-1',state:'pending',granted_seconds:0,consumed_seconds:0,pending:true}],
   children:[{id:'child-a',nickname:'小朋友A'},child],
   device_time_balances:[{child_id:'child-b',device_id:'device',balance_seconds:300}],redemptions:[]
  } as unknown as Dashboard;
  const html=renderToStaticMarkup(<SwitchWallet data={data} child={child} busy={false} mutate={async()=>null}/>);
  expect(html).toContain('选择Switch主机');
  expect(html).toContain('Switch 1（离线，可排队）');
  expect(html).toContain('Switch 2（离线，可排队）');
  expect(html).not.toContain('正在由 小朋友A 使用');
 });
});
