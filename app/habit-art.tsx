import type {ReactNode} from "react";
/** Semantic pictures never modify saved task data. */
export function habitPicture(name:string, fallback:string):string {
 const rules:[RegExp,string][]=[[/洗澡|淋浴|沐浴/,"bath"],[/上学|学校/,"school"],[/结束游戏|停止游戏|关闭游戏/,"game-stop"],[/写作业|写字/,"write"],[/专注|学习/,"focus"],[/睡|午休/,"sleep"],[/书包/,"bag"],[/玩具|书桌|收拾|整理/,"tidy"],[/看望|爷爷|奶奶|外公|外婆/,"family"],[/阅读|读书/,"read"],[/运动|户外|跑|跳|球/,"sport"]];
 return rules.find(([re])=>re.test(name))?.[1]||({book:"read",moon:"sleep",backpack:"bag",bag:"bag",pencil:"write",timer:"focus",sun:"sport"} as Record<string,string>)[fallback]||fallback;
}
export function HabitArt({name,icon}:{name:string;icon:string}) {
 const kind=habitPicture(name,icon);
 const art:Record<string,ReactNode>={
 read:<><path fill="#fff9e9" d="M6 11q9-4 18 1 9-5 18-1v26q-9-4-18 0-9-4-18 0z"/><path d="M24 12v25M11 17h8m-8 6h8m10-6h8m-8 6h8"/></>,
 write:<><rect x="7" y="8" width="26" height="33" rx="3" fill="#fff9e9"/><path d="M13 15h13m-13 7h9m-9 7h5"/><path fill="#f4ba60" d="m28 31 10-20 6 3-10 20-8 5z"/><path d="m28 31 6 3"/></>,
 school:<><path fill="#f4ba60" d="m5 20 19-14 19 14"/><path fill="#fff9e9" d="M9 20h30v22H9z"/><path fill="#91c3d2" d="M20 29h8v13M14 25h3m14 0h3"/><circle cx="24" cy="18" r="4" fill="#fff"/><path d="M24 15v3l2 1"/></>,
 bath:<><path d="M9 21V10a6 6 0 0 1 12 0"/><path fill="#91c3d2" d="M16 10h10l3 5H13z"/><path d="m17 19-1 3m7-3-1 3m7-3-1 3"/><path fill="#fff9e9" d="M5 28h38l-3 11H9z"/><path d="m12 39-1 4m25-4 1 4"/><circle cx="33" cy="24" r="3" fill="#b8dcde"/></>,
 sleep:<><path fill="#91c3d2" d="M5 25h38v14H5z"/><path d="M5 20v23m38-18v18"/><rect x="8" y="20" width="11" height="8" rx="3" fill="#fff9e9"/><path fill="#f4ba60" d="M33 4a9 9 0 1 0 10 11A9 9 0 0 1 33 4z"/></>,
 bag:<><path d="M17 11V8a7 7 0 0 1 14 0v3"/><rect x="10" y="11" width="28" height="32" rx="8" fill="#91c3d2"/><path d="M10 23h28"/><rect x="16" y="28" width="16" height="10" rx="3" fill="#fff9e9"/><path d="M19 16v4m10-4v4"/></>,
 tidy:<><path fill="#f4ba60" d="M7 24h34l-4 18H11z"/><path fill="#91c3d2" d="M8 12h12v12H8z"/><circle cx="31" cy="17" r="8" fill="#ecb5aa"/><path d="M19 31h10"/></>,
 family:<><circle cx="15" cy="17" r="8" fill="#fff0db"/><circle cx="34" cy="17" r="8" fill="#fff0db"/><path fill="#cad9d0" d="M6 39v-7q9-11 18 0v7m1 0v-7q9-11 18 0v7"/><path d="M8 13q7-9 14 0m5-2q7-8 14 2M11 17h3m3 0h3m9 0h3m3 0h3"/><path d="M13 22q2 2 4 0m15 0q2 2 4 0"/></>,
 sport:<><circle cx="28" cy="9" r="5" fill="#f4ba60"/><path d="m25 17-7 9 10 6-5 11m3-25 8 8h8M19 23H9m17 9 10 9"/><path d="M5 35h9m-7 6h6"/></>,
 focus:<><path fill="#fff9e9" d="M5 22h27v20H5z"/><path d="M18 23v19"/><circle cx="33" cy="15" r="11" fill="#91c3d2"/><path d="M33 8v7l5 3M30 2h6"/></>,
 "game-stop":<><path fill="#91c3d2" d="M11 17h22q6 0 9 18 0 8-8 1l-5-3H18l-6 3q-9 7-7-2 2-17 6-17z"/><path d="M13 23v9m-4-5h8"/><circle cx="32" cy="25" r="1"/><circle cx="36" cy="29" r="1"/><circle cx="34" cy="10" r="9" fill="#e9a79c"/><rect x="31" y="7" width="6" height="6" fill="#fff" stroke="none"/></>,
 };
 return <svg className="habit-picture" data-picture={kind} viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="#41685e" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{art[kind]||<path fill="#f4ba60" d="m24 5 6 12 13 2-10 10 2 14-11-7-12 7 3-14L5 19l13-2z"/>}</svg>;
}
