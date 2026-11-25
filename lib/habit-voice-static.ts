export const HABIT_AUDIO: Record<string,string> = {
  "主动开始写作业": "/audio/child-v7/template-00.wav",
  "完成一段专注学习": "/audio/child-v7/template-01.wav",
  "到时间主动结束游戏": "/audio/child-v7/template-02.wav",
  "整理玩具或书桌": "/audio/child-v7/template-03.wav",
  "自主阅读": "/audio/child-v7/template-04.wav",
  "按时睡觉": "/audio/child-v7/template-05.wav",
  "运动或户外活动": "/audio/child-v7/template-06.wav",
  "睡觉": "/audio/child-v7/habit-00.wav",
  "看望爷爷": "/audio/child-v7/habit-01.wav",
  "自己穿好衣服": "/audio/child-v7/habit-02.wav",
  "早晨刷牙、洗脸": "/audio/child-v7/habit-03.wav",
  "水杯、书包放到门口": "/audio/child-v7/habit-04.wav",
  "玩好后送玩具回家": "/audio/child-v7/habit-05.wav",
  "完成一件小家务": "/audio/child-v7/habit-06.wav",
  "坐在餐桌前吃饭": "/audio/child-v7/habit-07.wav",
  "睡前刷牙、洗脸": "/audio/child-v7/habit-08.wav",
  "到约定时间开始睡前准备": "/audio/child-v7/habit-09.wav",
  "刷牙": "/audio/child-v7/habit-10.wav",
  "洗脸": "/audio/child-v7/habit-11.wav",
  "吃饭": "/audio/child-v7/habit-12.wav",
  "整理书包": "/audio/child-v7/habit-13.wav",
  "收拾玩具": "/audio/child-v7/habit-14.wav",
  "阅读": "/audio/child-v7/habit-15.wav",
  "写作业": "/audio/child-v7/habit-16.wav",
  "运动": "/audio/child-v7/habit-17.wav",
  "喝水": "/audio/child-v7/habit-18.wav"
};

export const HABIT_VOICE_UNAVAILABLE="这条习惯的语音暂未准备好。";
export function habitVoiceText(name:string):string {
 const exact=name.trim();
 return Object.hasOwn(HABIT_AUDIO,exact)?exact:HABIT_VOICE_UNAVAILABLE;
}
