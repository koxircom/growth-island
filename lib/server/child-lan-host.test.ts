import { describe, expect, it } from "vitest";
import { isChildLanHost } from "./child-lan-host";
describe("child LAN visitor origin", () => {
  it("keeps existing private LAN access", () => {
    for (const host of ["192.168.50.75", "10.0.0.2", "172.16.0.1", "localhost"]) expect(isChildLanHost(`http://${host}:18340`)).toBe(true);
  });
  it("allows only explicitly configured HTTPS hostname", () => {
    expect(isChildLanHost("https://island.koxir.com:18443", "island.koxir.com")).toBe(true);
    expect(isChildLanHost("https://island.koxir.com:18443")).toBe(false);
    expect(isChildLanHost("http://island.koxir.com", "island.koxir.com")).toBe(false);
    expect(isChildLanHost("https://other.koxir.com", "island.koxir.com")).toBe(false);
    expect(isChildLanHost("https://island.koxir.com.evil.test", "island.koxir.com")).toBe(false);
    expect(isChildLanHost("https://public.test", "*.test")).toBe(false);
  });
  it("does not widen the private address range", () => {
    expect(isChildLanHost("https://172.32.1.1")).toBe(false);
    expect(isChildLanHost("https://192.169.1.1")).toBe(false);
  });
});
