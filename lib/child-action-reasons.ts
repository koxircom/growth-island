export function walletStartReason({active,available,hasLive,cooldown,selected}:{active:boolean;available:number;hasLive:boolean;cooldown:number|null;selected:number}){
 if(!active)return '这个奖励暂时休息啦，可以请家长帮忙看看。';
 if(available<=0)return '还没有可用时间，先去奖励小屋兑换哦。';
 if(hasLive)return '还有一项奖励正在使用，先结束它，再开始这一项哦。';
 if(cooldown===null)return '正在校准时间，等一小会儿，再试一次哦。';
 if(cooldown>0)return '现在是约定的休息时间，休息结束就能再开始啦。';
 if(!Number.isFinite(selected)||selected<=0)return '先选好这次使用多久，再点击开始哦。';
 return '';
}
export function tvStartReason({available,fresh,manualBlock,cooldown,windowOpen,seconds,exactSeconds=false}:{available:number;fresh:boolean;manualBlock:boolean;cooldown:boolean;windowOpen:boolean;seconds:number;exactSeconds?:boolean}){
 if(available<=0)return '还没有可用的电视时间，先去奖励小屋兑换哦。';
 if(!Number.isFinite(seconds)||seconds<(exactSeconds?1:60)||seconds>10800||(exactSeconds?!Number.isInteger(seconds):seconds%60!==0))return '这次想看几分钟呢？请选择一到一百八十分钟的整数哦。';
 if(manualBlock)return '家长暂时暂停了电视，可以一起商量什么时候看哦。';
 if(!fresh)return '还没确认电视状态，等一小会儿再试。时间不会因此扣掉哦。';
 if(cooldown)return '现在是约定的休息时间，休息结束就能再看啦。';
 if(!windowOpen)return '现在还没到约定的观看时间，到了时间再来吧。';
 return '';
}
