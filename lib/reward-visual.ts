export type RewardVisualKind = "tv" | "game" | "book" | "art" | "outdoors" | "food" | "icecream" | "toy" | "music" | "gift";
type Reward = { name?: string; kind?: string; device_id?: string | null };
type Settings = { tv_settings?: { device_id?: string | null } | null; switch_settings?: { device_id?: string | null } | null };
/** Presentation only: never dispatches, redeems or alters reward state. */
export function rewardVisual(reward: Reward, settings: Settings = {}): RewardVisualKind {
  if (reward.kind === "device_time" && reward.device_id) {
    if (reward.device_id === settings.switch_settings?.device_id) return "game";
    if (reward.device_id === settings.tv_settings?.device_id) return "tv";
  }
  if (reward.name === "挑一本新书") return "book";
  const name = (reward.name || "").normalize("NFKC").toLowerCase();
  const rules: [RewardVisualKind, RegExp][] = [
    ["game", /switch|游戏|遊戲|任天堂|电玩|電玩|\b(game|gaming|console)\b/],
    ["tv", /电视|電視|动画|動畫|电影|電影|\b(tv|television|movie|cartoon)\b/],
    ["book", /阅读|閱讀|读书|讀書|绘本|繪本|故事|图书|圖書|\b(book|reading|story)\b/],
    ["art", /画画|畫畫|绘画|繪畫|手工|美术|美術|涂鸦|塗鴉|\b(art|paint|painting|craft)\b/],
    ["icecream", /冰淇淋|冰激凌|雪糕|\bice cream\b/],
    ["food", /蛋糕|甜点|甜點|零食|美食|餐厅|餐廳|披萨|披薩|\b(food|cake|snack|pizza|ice cream)\b/],
    ["outdoors", /公园|公園|户外|戶外|野餐|露营|露營|骑车|騎車|游乐|遊樂|运动|運動|散步|\b(park|outdoor|picnic|camping|sport)\b/],
    ["music", /音乐|音樂|唱歌|乐器|樂器|\b(music|singing)\b/],
    ["toy", /玩具|积木|積木|拼图|拼圖|乐高|樂高|\b(toy|lego|puzzle)\b/],
  ];
  return rules.find(([,pattern]) => pattern.test(name))?.[0] || "gift";
}
