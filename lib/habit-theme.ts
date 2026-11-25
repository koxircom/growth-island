/** Only replace generic placeholders, never a parent's chosen specific icon. */
export function habitTheme(name:string,icon:string):string {
 if(["book","focus","game","bag","tidy","moon","sport","heart","shirt","meal","wash","water","family"].includes(icon))return icon;
 const rules:[RegExp,string][]=[
 [/睡|午休/,"moon"],[/看望|爷爷|奶奶|外公|外婆/,"family"],
 [/穿|衣服/,"shirt"],[/吃|餐|饭/,"meal"],[/刷牙|洗脸|洗手/,"wash"],
 [/喝水|水杯/,"water"],[/书包/,"bag"],[/玩具|收拾|整理|家务/,"tidy"],
 [/阅读|读书|作业|写字/,"book"],[/运动|跑|跳|球/,"sport"]];
 return rules.find(([pattern])=>pattern.test(name))?.[1]||"star";
}
