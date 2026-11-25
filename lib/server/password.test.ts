import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, validEmail, validPassword, verifyPassword } from "./password.mjs";
describe("local parent passwords", () => {
  it("normalizes email and validates input", () => {
    expect(normalizeEmail(" Parent@Example.test ")).toBe("parent@example.test");
    expect(validEmail("parent@example.test")).toBe(true);
    expect(validEmail("not an email")).toBe(false);
    expect(validPassword("123456789012")).toBe(true);
    expect(validPassword("x")).toBe(true);
    expect(validPassword("")).toBe(false);
    expect(validPassword("短")).toBe(true);
    expect(validPassword("x".repeat(129))).toBe(false);
  });
  it("salts hashes and verifies without storing plaintext", async () => {
    const password = "not-a-real-family-password";
    const first = await hashPassword(password), second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password + "!", first)).toBe(false);
    expect(await verifyPassword(password, undefined)).toBe(false);
    expect(await verifyPassword(password, "malformed")).toBe(false);
  });
});
