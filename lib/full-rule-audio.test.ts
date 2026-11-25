import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CHILD_AUDIO,RULE_BASICS_TEXT,RULE_STREAK_TEXT,RULE_SAVINGS_TEXT,RULE_TIMING_REVIEW_TEXT} from './child-audio-manifest';
it('full rule paragraphs preserve their final clauses and use new complete assets',()=>{
 const rules=[[RULE_BASICS_TEXT,'遇到困难可以和家长商量。'],[RULE_STREAK_TEXT,'暂停或归档会清零。'],[RULE_SAVINGS_TEXT,'不按百分比复利。'],[RULE_TIMING_REVIEW_TEXT,'已发奖励不会因后来修改打卡自动扣回。']];
 for(const [text,end] of rules){expect(text.endsWith(end)).toBe(true);expect(text.length).toBeLessThan(180);expect(CHILD_AUDIO[text]).toMatch(/^\/audio\/child-v4\/.*complete.wav$/);const b=readFileSync('public'+CHILD_AUDIO[text]);expect(b.subarray(0,4).toString()).toBe('RIFF');expect(b.length).toBeGreaterThan(50000);expect(b.length).toBeLessThan(3*1024*1024);}
});
it('visible child rule text and speaker share the same constants, preventing stale shorter scripts',()=>{
 const source=readFileSync('app/star-rules.tsx','utf8');
 for(const name of ['RULE_BASICS_TEXT','RULE_STREAK_TEXT','RULE_SAVINGS_TEXT','RULE_TIMING_REVIEW_TEXT']){expect(source).toContain('text={'+name+'}');expect(source.split(name).length-1).toBeGreaterThanOrEqual(3);}
});
