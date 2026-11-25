import { afterEach, describe, expect, it } from "vitest";
import { appOrigin, readBody } from "./http";
const previous = process.env.APP_ORIGIN;
const previousLan = process.env.ALLOW_LAN_HTTP;
afterEach(() => { if (previousLan === undefined) delete process.env.ALLOW_LAN_HTTP; else process.env.ALLOW_LAN_HTTP = previousLan; if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous; });
describe("same-origin API boundary", () => {
  it("requires HTTPS outside loopback", () => {
    process.env.APP_ORIGIN = "http://192.168.1.8:18340";
    expect(() => appOrigin()).toThrow("HTTPS");
    process.env.APP_ORIGIN = "https://island.example.test";
    expect(appOrigin()).toBe("https://island.example.test");
  });
  it("allows explicit private LAN HTTP but rejects public plaintext origins", () => {
    process.env.ALLOW_LAN_HTTP = "true";
    for (const host of ["192.168.50.75", "10.0.0.2", "172.16.1.2"]) {
      process.env.APP_ORIGIN = `http://${host}:18340`;
      expect(appOrigin()).toBe(process.env.APP_ORIGIN);
    }
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1"]) {
      process.env.APP_ORIGIN = `http://${host}:18340`;
      expect(() => appOrigin()).toThrow("HTTPS");
    }
  });
  it("rejects cross-site, malformed and oversized input", async () => {
    process.env.APP_ORIGIN = "http://localhost:18340";
    const req = (body: string, origin = "http://localhost:18340") => new Request("http://localhost:18340/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body });
    await expect(readBody(req("{}", "https://evil.example"))).rejects.toThrow("origin_not_allowed");
    await expect(readBody(req("[]"))).rejects.toThrow("invalid_request");
    await expect(readBody(req(JSON.stringify({ value: "x".repeat(17000) })))).rejects.toThrow("request_too_large");
    await expect(readBody(req('{"hello":"world"}'))).resolves.toEqual({ hello: "world" });
  });
});
