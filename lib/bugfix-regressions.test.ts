import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { publishChildScopeChange, publishLedgerInvalidation } from "./ledger-invalidation";
import { formatTimezoneLabel, safeError } from "./model";
import { APP_VERSION } from "./version";

describe("growth island bugfix-v1 regressions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps proxy HTML JSON SyntaxError messages cleanly to Chinese service_unavailable text", () => {
    expect(safeError(new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"))).toBe(
      "家庭服务器暂时无法连接，请稍后重试。",
    );
  });

  it("publishes ledger invalidations when crypto.randomUUID is unavailable (LAN HTTP)", () => {
    const posted: unknown[] = [];
    class Channel {
      postMessage(v: unknown) { posted.push(v); }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i + 1) & 0xff;
        return arr;
      },
    });
    expect(() => publishLedgerInvalidation("a".repeat(64))).not.toThrow();
    expect(() => publishChildScopeChange()).not.toThrow();
    expect(posted).toHaveLength(2);
  });

  it("ensures client components do not call bare crypto.randomUUID and /api/time accepts childViewer", () => {
    const clientFiles = [
      "app/peer-penalties.tsx",
      "app/sortable-habit-list.tsx",
      "app/penalty-rule-settings.tsx",
      "app/parent-tv-settings.tsx",
      "lib/ledger-invalidation.ts",
    ];
    for (const file of clientFiles) {
      expect(readFileSync(file, "utf8")).not.toContain("crypto.randomUUID");
    }
    const timeRoute = readFileSync("app/api/time/route.ts", "utf8");
    expect(timeRoute).toContain("childViewer");
    expect(timeRoute).not.toContain("sessionUser");
  });
});


describe("growth island v1.0.5 patrol regressions", () => {
  it("keeps APP_VERSION synced with package.json and renders it in footer", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toBe("1.0.7");
    expect(readFileSync("app/page.tsx", "utf8")).toContain("v{APP_VERSION}");
  });

  it("formats common IANA timezones into friendly Chinese labels with fallback", () => {
    expect(formatTimezoneLabel("Asia/Shanghai")).toBe("北京时间");
    expect(formatTimezoneLabel("America/New_York")).toBe("纽约时间");
    expect(formatTimezoneLabel("UTC")).toBe("UTC");
  });

  it("avoids duplicate 说明 in peer penalties heading speaker label", () => {
    const src = readFileSync("app/peer-penalties.tsx", "utf8");
    expect(src).not.toContain('label="惩罚页说明"');
    expect(src).toContain('label="惩罚页"');
  });

  it("guards <dialog>.showModal() against already-open InvalidStateError across all dialog components", () => {
    const dialogFiles = [
      "app/page.tsx",
      "app/child-access-controls.tsx",
      "app/history-proposals.tsx",
      "app/penalty-rule-settings.tsx",
      "app/habit-rule-dialog.tsx",
      "app/child-password-dialog.tsx",
    ];
    for (const file of dialogFiles) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("?.showModal()");
      expect(src).toContain(".open");
    }
  });
});
