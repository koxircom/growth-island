import {describe,it,expect,afterEach} from "vitest";
import {encryptChildPassword,decryptChildPassword} from "./child-password-crypto";
afterEach(()=>{delete process.env.CHILD_PASSWORD_ENCRYPTION_KEY;});
describe("child password reversible storage",()=>{
 it("fails closed without a dedicated key",()=>{delete process.env.CHILD_PASSWORD_ENCRYPTION_KEY;expect(()=>encryptChildPassword("synthetic-a","1234")).toThrow("child_password_key_unavailable");});
 it("randomizes ciphertext and decrypts only for bound child",()=>{process.env.CHILD_PASSWORD_ENCRYPTION_KEY="ab".repeat(32);const x=encryptChildPassword("synthetic-a","1234");expect(x).not.toContain("1234");expect(x).not.toEqual(encryptChildPassword("synthetic-a","1234"));expect(decryptChildPassword("synthetic-a",x)).toBe("1234");expect(()=>decryptChildPassword("synthetic-b",x)).toThrow();});
 it("rejects wrong key and tampered tag",()=>{process.env.CHILD_PASSWORD_ENCRYPTION_KEY="ab".repeat(32);const x=encryptChildPassword("synthetic-a","1234");const p=x.split(".");p[2]="00".repeat(16);expect(()=>decryptChildPassword("synthetic-a",p.join("."))).toThrow();process.env.CHILD_PASSWORD_ENCRYPTION_KEY="cd".repeat(32);expect(()=>decryptChildPassword("synthetic-a",x)).toThrow();});
});
