import {describe,it,expect} from "vitest";
import {rewardVisual} from "./reward-visual";
describe("reward illustration semantics", () => {
  it.each([["看电视十分钟","tv"],["SWITCH 时间","game"],["读书","book"],["画画","art"],["公园野餐","outdoors"],["冰淇淋","icecream"],["生日蛋糕","food"],["拼图玩具","toy"],["听音乐","music"],["自选惊喜","gift"],["","gift"],["activity","gift"]])("%s -> %s",(name,kind)=>expect(rewardVisual({name})).toBe(kind));
  it("uses configured device identity before display name",()=>{
    const settings={tv_settings:{device_id:"tv-1"},switch_settings:{device_id:"sw-1"}};
    expect(rewardVisual({name:"任意名称",kind:"device_time",device_id:"tv-1"},settings)).toBe("tv");
    expect(rewardVisual({name:"看电视",kind:"device_time",device_id:"sw-1"},settings)).toBe("game");
    expect(rewardVisual({name:"画画",kind:"manual",device_id:"tv-1"},settings)).toBe("art");
  });
  it("does not match missing ids or invent unknown devices",()=>{
    expect(rewardVisual({kind:"device_time"},{})).toBe("gift");
    expect(rewardVisual({kind:"device_time",device_id:"other",name:"特别奖励"},{})).toBe("gift");
  });
  it("is unchanged by reordering and rename updates immediately",()=>{
    const names=["读书","看电视","玩具"]; const result=names.map(name=>rewardVisual({name}));
    expect([...names].reverse().map(name=>rewardVisual({name}))).toEqual([...result].reverse());
    expect(rewardVisual({name:"看电视"})).not.toBe(rewardVisual({name:"画画"}));
  });
});
