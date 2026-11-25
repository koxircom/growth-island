import type {Dashboard} from './model';
export function pendingReviewCount(data:Dashboard){return data.checkins.filter(c=>c.status==='pending').length+data.redemptions.filter(r=>r.status==='pending').length+(data.history_proposals||[]).filter(p=>p.status==='pending').length;}
export function reviewDay(day:string){const d=new Date(day+'T12:00:00Z');return Number.isNaN(d.getTime())?day:day+' 星期'+['日','一','二','三','四','五','六'][d.getUTCDay()];}
export function requestTime(value:string|undefined,timezone:string){if(!value||Number.isNaN(Date.parse(value)))return '申请时间未记录';return new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value));}
