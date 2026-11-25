export function PendingBadge({count}:{count:number}){return count>0?<span className="pending-count" aria-label={`${count} 项待确认`}>{count>99?'99+':count}</span>:null;}
