export type SwitchRedemption = {
 id:string;child_id:string;device_id:string;device_name:string;reward_name:string;cost:number;
 duration_seconds:number;status:"pending"|"approved"|"rejected";created_at:string;reviewed_at:string|null;credited_seconds:number|string|null;
};
export type SwitchOperations = {
 read_at:string;devices:{id:string;name:string;active:boolean}[];children:{id:string;nickname:string}[];
 balances:{child_id:string;device_id:string;seconds:number|string}[];
 redemptions:SwitchRedemption[];
 usage:{id:string;child_id:string;device_id:string;device_name:string;started_at:string;deadline_at:string;ended_at:string|null;reserved_seconds:number;actual_seconds:number;status:string}[];
};
// Local accounting is not Switch telemetry or proof that a command was applied.
// No UI or generic MQTT ACK may promote an order to "confirmed".
export function redemptionDiagnosis(r:SwitchRedemption) {
 if(r.status==="pending") return {label:"等待家长确认",detail:"尚未批准，未给时间钱包入账。",attention:false};
 if(r.status==="rejected") return {label:"兑换未通过",detail:"家长未批准本次兑换。",attention:false};
 if(r.credited_seconds===null || Number(r.credited_seconds)!==r.duration_seconds)
  return {label:"到账异常，需人工核查",detail:"已批准，但时间入账记录缺失或与兑换时长不一致。不要再次兑换，请先核查账本。",attention:true};
 return {label:"钱包已到账 · 设备生效未知",detail:"仅确认小岛时间钱包已入账。当前应用未接入 Switch 状态和可关联本次兑换的设备回执，不能证明主机已加时。",attention:true};
}
export const switchStatusLimitations = {
 online:"未知（未接入设备状态）",
 remaining:"未知（无设备上报）",
 explanation:"小岛倒计时和钱包余额不是 Switch 剩余游戏时间。当前没有设备状态读取适配器，也没有可核对具体兑换的执行回执。",
};
