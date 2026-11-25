"use client";
import {useState} from "react";
import type {DeviceSchedule,FamilyDevice} from "@/lib/model";
export function DeviceScheduleFields({device,timezone}:{device:FamilyDevice;timezone:string}) {
 const [enabled,setEnabled]=useState(!!device.schedule_enabled);
 const [rules,setRules]=useState<DeviceSchedule[]>(device.schedules||[]);
 const update=(i:number,patch:Partial<DeviceSchedule>)=>setRules(items=>items.map((r,j)=>i===j?{...r,...patch}:r));
 return <fieldset><legend>允许使用的时段</legend>
 <label className="checkbox"><input name="schedule_enabled" type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>只允许在指定时段开始或追加时间</label>
 <input type="hidden" name="device_schedules" value={JSON.stringify(rules)}/>
 <p className="small">按家庭时区 {timezone}。兑换随时到账，使用和追加不能超过当前时段的结束时间。这里约束普通计时，不代表已经向 Switch 下发时间。</p>
 {enabled&&<><p className="small">没有启用的时段时不能开始或追加；跨午夜时段按开始当天计算。修改时段不会撤回已经开始的计时。</p>
 {rules.map((r,i)=><fieldset key={i}><legend>时段 {i+1}</legend>
 <label className="checkbox"><input type="checkbox" checked={r.enabled} onChange={e=>update(i,{enabled:e.target.checked})}/>启用时段</label>
 <div className="button-row"><button type="button" className="secondary" onClick={()=>update(i,{days:[1,2,3,4,5,6,7]})}>全选星期</button><button type="button" className="secondary" onClick={()=>update(i,{days:[]})}>清除星期</button></div><div className="tv-days">{["一","二","三","四","五","六","日"].map((day,k)=><label key={day}><input type="checkbox" checked={r.days.includes(k+1)} onChange={e=>update(i,{days:e.target.checked?[...r.days,k+1]:r.days.filter(d=>d!==k+1)})}/>周{day}</label>)}</div>
 <label className="field">开始<input type="time" required value={r.start} onChange={e=>update(i,{start:e.target.value})}/></label>
 <label className="field">结束<input type="time" required value={r.end} onChange={e=>update(i,{end:e.target.value})}/></label>
 <button type="button" className="secondary" onClick={()=>setRules(items=>items.filter((_,j)=>i!==j))}>移除时段</button>
 </fieldset>)}
 <button type="button" className="secondary" disabled={rules.length>=20} onClick={()=>setRules(items=>[...items,{days:[1,2,3,4,5,6,7],start:"18:00",end:"20:00",enabled:false}])}>添加允许时段</button></>}
 </fieldset>;
}
