import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChildStarBalance } from "./child-star-balance";
import type { Child, Dashboard } from "../lib/model";

const child: Child = { id: "a", nickname: "快乐小岛居民", avatar: "bear", color: "green", weekday_minutes: 0, weekend_minutes: 60 };
const data = { family: { id: "f", name: "QA", timezone: "UTC" }, children: [child], habits: [], checkins: [], timers: [], rewards: [], redemptions: [], rests: [], star_balances: [{ child_id: "a", balance: 13 }, { child_id: "b", balance: 7 }] } satisfies Dashboard;
describe("child star balance", () => {
  it("renders spendable balance rather than earned stars with accessible child identity", () => {
    const html = renderToStaticMarkup(createElement(ChildStarBalance, { data, child }));
    expect(html).toContain('aria-label="快乐小岛居民的可用星星余额：13颗"');
    expect(html).toContain('aria-hidden="true">13</span>');
    expect(html).not.toContain('>20<');
  });
  it("keeps siblings separate and defaults missing wallets to zero", () => {
    expect(renderToStaticMarkup(createElement(ChildStarBalance, { data, child: { ...child, id: "b" } }))).toContain('余额：7颗');
    expect(renderToStaticMarkup(createElement(ChildStarBalance, { data, child: { ...child, id: "missing" } }))).toContain('余额：0颗');
  });
  it("preserves all digits of large balances", () => {
    expect(renderToStaticMarkup(createElement(ChildStarBalance, { child, data: { ...data, star_balances: [{ child_id: "a", balance: 999999997 }] } }))).toContain('余额：999999997颗');
  });
});
