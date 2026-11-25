import {checkinHabitName,redemptionName,type Dashboard,type StarLedgerEntry} from "./model";
export function ledgerDescription(data:Dashboard,row:StarLedgerEntry){
 const checkin=data.checkins.find(x=>x.id===row.source_id);
 const redemption=data.redemptions.find(x=>x.id===row.source_id);
 if(checkin&&(row.source_type==="checkin"||row.source_type==="undo")) return (row.source_type==="undo"?"撤销 · ":"")+checkinHabitName(data,checkin);
 if(redemption&&(row.source_type==="redemption"||row.source_type==="refund")) return (row.source_type==="refund"?"退回 · ":"")+redemptionName(redemption,data.rewards);
 if(row.source_type==="manual_bonus") return data.manual_star_grants?.find(x=>x.id===row.source_id)?.reason||"家长鼓励";
 if(row.source_type==="star_adjustment") return data.star_adjustments?.find(x=>x.id===row.source_id)?.reason||"星星调整";
 return ({manual_reversal:"纠正加星",checkin:"习惯打卡",undo:"撤销打卡",redemption:"奖励兑换",refund:"退回星星"} as Record<string,string>)[row.source_type]||"星星收支";
}
