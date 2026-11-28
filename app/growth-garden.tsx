"use client";
import {speakChildFeedback} from "@/lib/child-voice";
import {CHILD_AUDIO} from "@/lib/child-audio-manifest";
import { useState } from "react";
import { Timer as TimerIcon, MessageCircle } from "lucide-react";
import { gardenStage, type GrowthFeedback } from "@/lib/growth-feedback";
import type { Child } from "@/lib/model";

const invitations = [
  "刚才哪一步，是你自己想办法完成的？",
  "如果有点难，下一次可以先做哪一小步？",
  "今天你想感谢自己什么？小小的尝试也算。",
];
/** A daily reflection, not an extra currency or an endlessly replayable reward. */
export function GrowthGarden({ child, done, rest, feedback, onFocus }: {
  child: Child; done: number; rest: boolean; feedback: GrowthFeedback | null; onFocus: () => void;
}) {
  const [question, setQuestion] = useState(-1);
  const stage = gardenStage(done);
  const celebrating = feedback?.childId === child.id && !feedback.pending;
  return <section className="panel buddy-panel growth-garden" aria-label="今日成长花园">
    <div className="garden-caption"><span>今日成长花园</span><span>慢慢来就好</span></div>
    <svg className={celebrating ? "garden-scene is-celebrating" : "garden-scene"} key={celebrating ? feedback.key : "quiet"} viewBox="0 0 320 174" aria-hidden="true">
      <rect x="0" y="0" width="320" height="174" rx="22" fill="#e9f5f3" />
      <circle cx="268" cy="35" r="17" fill={rest ? "#d4dcf0" : "#f9dc8e"} />
      <path className="garden-cloud" d="M25 42h65q-2-16-18-15-14-21-30-3-17-1-17 18" fill="#fff" />
      <ellipse cx="160" cy="151" rx="137" ry="21" fill="#a7cdb0" />
      <path d="M84 156q70-26 142-3" stroke="#e9d6aa" strokeWidth="13" fill="none" />
      {[0,1,2].map((i) => <g key={i} className={stage > i ? "garden-flower blooming" : "garden-flower"} style={{ transformOrigin: `${42 + i*24}px 142px`, animationDelay: `${i*100}ms` }}>
        <path d={`M${42+i*24} 144v-18m0 12q-10-12-14-5m14 8q8-12 13-8`} stroke="#6e9b76" strokeWidth="3" fill="none" strokeLinecap="round"/>
        {stage > i ? <g fill={["#edaf9b","#efd17f","#b4a6d5"][i]}>
          <circle cx={42+i*24} cy="119" r="6"/><circle cx={36+i*24} cy="125" r="6"/><circle cx={48+i*24} cy="125" r="6"/><circle cx={42+i*24} cy="131" r="6"/><circle cx={42+i*24} cy="125" r="4" fill="#fff1b9"/>
        </g> : <ellipse cx={42+i*24} cy="126" rx="4" ry="7" fill="#79ad89"/>}
      </g>)}
      <g className="garden-buddy">
        <path className="garden-tail" d="M227 142q39-14 27-44-24 5-25 29" fill="#dba477"/>
        <path d="M248 104q9 11 4 20l-14-12z" fill="#fff2df"/>
        <ellipse cx="205" cy="137" rx="23" ry="21" fill="#dba477"/>
        <ellipse cx="205" cy="141" rx="13" ry="13" fill="#fff2df"/>
        <path d="M181 102l-4-31 22 16m13 0 23-16-4 31" fill="#dba477"/>
        <ellipse cx="205" cy="108" rx="30" ry="27" fill="#e0ae81"/>
        <path d="M175 109q30 4 30 21 0-17 30-21-3 25-30 25t-30-25" fill="#fff2df"/>
        <g className="garden-eyes"><circle cx="194" cy="105" r="2.5" fill="#3e5549"/><circle cx="216" cy="105" r="2.5" fill="#3e5549"/></g>
        <ellipse cx="205" cy="117" rx="3.5" ry="2.5" fill="#3e5549"/>
        <path d="M200 123q5 5 10 0" fill="none" stroke="#3e5549" strokeWidth="2" strokeLinecap="round"/>
        <path className="garden-wave" d="M185 132q-17-6-15-19" stroke="#dba477" strokeWidth="10" strokeLinecap="round" fill="none"/>
        <circle cx="185" cy="115" r="4" fill="#edae9e"/><circle cx="225" cy="115" r="4" fill="#edae9e"/>
      </g>
      {celebrating && <g className="garden-sparkles" fill="#e4b65f"><path d="m148 68 3 7 8 2-6 5 1 8-6-4-7 4 1-8-6-5 8-2z"/><path d="m265 72 3 5 5 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1z"/></g>}
    </svg>
    <h3>{rest ? "今天，和小伙伴一起休息" : done > 0 ? "每一小步，都在悄悄开花" : "小芽已准备好，陪你慢慢来"}</h3>
    <p className="garden-message">{rest ? "休息也是照顾自己，不需要补满任务。" : done > 0 ? `今天已确认 ${done} 次小尝试。小花只是记录，不用追着它做任务。` : "先选一件容易开始的小事。不必一次做很多。"}</p>
    <button className="text-button garden-talk" onClick={() => {const next=(question+1)%invitations.length;setQuestion(next);if(CHILD_AUDIO[invitations[next]])speakChildFeedback(invitations[next]);}}><MessageCircle size={17}/>和小伙伴聊一句</button>
    {question >= 0 && <p className="garden-question" role="status">{invitations[question]}<small>在心里想一想，或说给家人听，不用填写。</small></p>}
    <button className="secondary" onClick={onFocus}><TimerIcon size={17}/>开始一段专注</button>
    <small className="garden-footnote">每日小花 · 随今天已确认的记录变化 · 不消耗星星</small>
  </section>;
}
