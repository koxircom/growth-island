import { rewardVisual } from "../lib/reward-visual";
type Props = { reward: Parameters<typeof rewardVisual>[0]; settings?: Parameters<typeof rewardVisual>[1] };
/** Code-native illustration, matching Island/Animal: sage, cream and terracotta. */
export function RewardArt({reward, settings}: Props) {
  const kind = rewardVisual(reward, settings);
  return <div className="reward-art" data-reward-art={kind}>
    <svg viewBox="0 0 220 130" width="220" height="130" style={{width:"100%",height:"100%"}} fill="none" aria-hidden="true" focusable="false">
      <ellipse cx="110" cy="110" rx="67" ry="9" fill="#d9ddc7"/>
      <circle cx="110" cy="63" r="46" fill="#e8efdf"/>
      <path d="M30 78q-8-19 6-28 7 16-6 28M183 90q-5-17 9-23 4 15-9 23" fill="#93b89a"/>
      <path d="m174 28 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#d8ac68"/>
      <g stroke="#476759" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {kind === "tv" && <><path d="m84 106 6-13m46 13-6-13"/><rect x="55" y="34" width="110" height="62" rx="10" fill="#88aa91"/><rect x="63" y="42" width="83" height="46" rx="5" fill="#fff6e6"/><path d="m68 79 22-20 17 15 16-21 19 26" fill="#bad6ab" stroke="none"/><circle cx="127" cy="53" r="6" fill="#e4b879" stroke="none"/><circle cx="155" cy="55" r="3" fill="#fff6e6" stroke="none"/><path d="M153 70h4m-4 7h4"/></>}
        {kind === "game" && <><rect x="49" y="42" width="122" height="56" rx="18" fill="#ddaa85"/><rect x="72" y="42" width="76" height="56" rx="3" fill="#476759"/><rect x="79" y="49" width="62" height="42" rx="4" fill="#dce9d5" stroke="none"/><path d="m87 81 13-15 12 8 19-17" stroke="#89ad90"/><path d="M61 60v14m-7-7h14"/><circle cx="158" cy="60" r="3" fill="#fff6e6" stroke="none"/><circle cx="158" cy="78" r="3" fill="#fff6e6" stroke="none"/></>}
        {kind === "book" && <><path d="M110 48q-26-15-52-5v55q25-8 52 5 27-13 52-5V43q-26-10-52 5z" fill="#fff6e6"/><path d="M110 48v55M70 58q15-4 27 3m-27 9q15-4 27 3m-27 9q15-4 27 3m26-24q14-7 27-3m-27 15q14-7 27-3" stroke="#93b89a"/><path d="M131 40v18l7-4 7 2V39" fill="#ddaa85" stroke="none"/></>}
        {kind === "art" && <><path d="M95 35c-35 0-51 46-22 65 26 17 68 7 68-10 0-10-15-6-15-17s23-4 23-17-26-21-54-21z" fill="#fff6e6"/><circle cx="82" cy="55" r="7" fill="#ddaa85" stroke="none"/><circle cx="67" cy="76" r="7" fill="#93b89a" stroke="none"/><circle cx="89" cy="94" r="7" fill="#e4b879" stroke="none"/><path d="m123 91 33-51 8 5-35 48z" fill="#b5855c"/><path d="m123 91-10 15 16-13" fill="#89ad90"/></>}
        {kind === "outdoors" && <><path d="M53 101q56-21 114 0" stroke="#93b89a" strokeWidth="8"/><path d="m93 99 29-48 30 48z" fill="#ddaa85"/><path d="m112 99 10-25 12 25" fill="#fff6e6"/><path d="M70 93V53"/><path d="m70 35-21 36h42z" fill="#93b89a"/><circle cx="154" cy="35" r="11" fill="#e4b879" stroke="none"/></>}
        {kind === "icecream" && <><path d="m84 68 26 42 26-42z" fill="#d6ac78"/><path d="m96 76 22 25m-13-26 19 13m-28 0 13-14m-6 25 22-24" stroke="#b5855c" strokeWidth="2"/><path d="M79 68c-10-10-5-24 7-27 0-14 14-22 25-16 11-6 25 2 25 16 12 3 17 17 7 27z" fill="#fff6e6"/><path d="M91 47q7-8 15-6" stroke="#ddaa85"/></>}
        {kind === "food" && <><path d="m76 72 12 33h45l12-33z" fill="#ddaa85"/><path d="M75 73c-11-13 1-29 15-26 5-22 38-22 43 0 16-3 27 15 13 26z" fill="#fff6e6"/><circle cx="111" cy="34" r="7" fill="#d99883" stroke="none"/><path d="m97 85 3 12m22-12-3 12" stroke="#fff6e6"/></>}
        {kind === "toy" && <><rect x="59" y="70" width="51" height="35" rx="5" fill="#ddaa85"/><rect x="110" y="70" width="51" height="35" rx="5" fill="#e4b879"/><rect x="84" y="35" width="51" height="35" rx="5" fill="#93b89a"/><path d="M93 35v-7h12v7m10 0v-7h12v7M68 70v-7h12v7m10 0v-7h12v7m17 0v-7h12v7m10 0v-7h12v7" fill="#bad6ab"/></>}
        {kind === "music" && <><path d="M95 88V42l51-11v45M95 54l51-11" strokeWidth="6"/><ellipse cx="82" cy="91" rx="15" ry="10" fill="#ddaa85"/><ellipse cx="133" cy="79" rx="15" ry="10" fill="#93b89a"/><path d="m58 44 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#e4b879" stroke="none"/></>}
        {kind === "gift" && <><rect x="71" y="58" width="78" height="47" rx="5" fill="#93b89a"/><rect x="64" y="47" width="92" height="18" rx="4" fill="#bad6ab"/><path d="M103 48v57h14V48" fill="#e4b879"/><path d="M110 46c-31 0-34-27-18-25 11 2 18 25 18 25zm0 0c31 0 34-27 18-25-11 2-18 25-18 25z" fill="#ddaa85"/></>}
      </g>
    </svg>
  </div>;
}
