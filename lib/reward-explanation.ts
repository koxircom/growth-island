
type RewardInfo={name:string;cost:number;kind?:string;device_id?:string|null;duration_seconds?:number|null};
export function rewardExplanation(r:RewardInfo,devices:{tv?:string|null;switch?:string|null}={}){
 const intro=r.name+'，需要'+r.cost+'颗星星。';
 if(r.kind!=='device_time')return intro+'提交后星星先预留，等家长确认；如果没有安排，星星会退回。';
 const minutes=Math.floor(Number(r.duration_seconds)/60);
 if(r.device_id&&r.device_id===devices.switch)return intro+'兑换'+minutes+'分钟，先存进Switch余额。开始使用时再发送，等主机联网确认后才开始。';
 if(r.device_id&&r.device_id===devices.tv)return intro+'兑换'+minutes+'分钟，先存进电视余额，准备好再开始观看。';
 return intro+'兑换'+minutes+'分钟设备时间，请按家庭约定使用。';
}
