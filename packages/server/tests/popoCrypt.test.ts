import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptEvent,
  encryptEvent,
  verifySignature,
} from "../src/popo/crypt.js";

function testKey(): string {
  // 32 位（前 16 为 key、后 16 为 IV，真实协议规格）
  return crypto.randomBytes(16).toString("hex") + crypto.randomBytes(16).toString("hex");
}

describe("popo crypt", () => {
  it("verifySignature matches popo sha256 of sorted token/timestamp/nonce", () => {
    const token = "openclawtk";
    const timestamp = "1786956792695";
    const nonce = "zf1h2jfuossvrk3e";
    // 真实协议（2026-08-17 实测）：signature = SHA256(sort(token,timestamp,nonce).join(""))
    const sorted = [token, timestamp, nonce].sort().join("");
    const signature = crypto.createHash("sha256").update(sorted).digest("hex");
    expect(verifySignature({ token, timestamp, nonce, signature })).toBe(true);
    expect(
      verifySignature({
        token,
        timestamp,
        nonce,
        signature: "deadbeef",
      }),
    ).toBe(false);
  });

  it("decryptEvent round-trips encryptEvent", () => {
    const key = testKey();
    const message = '{"eventType":"IM_P2P_TO_ROBOT_MSG","eventData":{}}';
    const encrypted = encryptEvent(key, message);
    expect(decryptEvent(key, encrypted)).toBe(message);
  });

  it("rejects aesKey of wrong length", () => {
    expect(() => decryptEvent("short", "AAAA")).toThrow(/aesKey/);
  });

  // 真实推送回归向量（2026-08-17 实测抓取）：加密 key=aesKey 前 16 字节、IV=后 16 字节，
  // 明文为完整事件 JSON。防止协议被意外改坏。
  it("decrypts the real captured push (IM_P2P_TO_ROBOT_MSG 哈喽)", () => {
    const aesKey = "frx2T6DXr6kiP3108Q8JErniG3QJeR8k";
    const encrypt =
      "g5sHMhfUCF7VkdnBHTXwhwSKES7X8dQXkXMlAKr7kDaBlAQTMxIv1Ytkdwmw/5pFWC/MmPuBVqArP1kYO2lxmwDd9lAnd+zYFArDxrkFCXk7zPYkYkVY4rfSFRlSW1cWYEd1GJA02cTrkzaeoB7yAu+kNtHG8al8R4UAG+9JjrcxBfAmd/cAWS0Des7kW6mtEJdE4QcvjRuizjox85Zt4WJNnhKKOFz7DlyyuO6ExrINhIHdxnru3OkqbTnm7TgBCZ89VkxLGHzta9vjE5SDatL2XjcM8ZrlRoaRExha15d/4JUL095mtV0245gEVf2ohaf0efb1teAhKyTFXuOq5dgEHoovfjfnVSSsPyMKGDUM/c+t9DSpEkm1ifPBFyPv2yvXn35oTpCCS1wyE3/+vtqsPPzIDRdPStlHcCH1pp+EdY14poU0zTwgf01eic8jCCL7+hpEUEeW+KtQJNsiFmiqnE1vn7XwgrF6HCB967ysNmluCgXLQpV2FYp7rh0PI0GB14J6PFLhOcEQLXcHmwhykADoR9WdaOWSGtktayu96T2xffxFiXchcllxlSiwBbEhIDmT0nrpSiR+1sdA5eps8EfU39fnxTmxNZcEv7PUGEtrKYkO8Lm8vrY8nmzoDW7qv1EiDY71kgF1YOMYuyVn1aZWCdie/eNtM3XG5U2G2KmoN4L7oCBIMygCw04JCAp58DeNVsmY9Gqz3QyiqEDavAuat3Kf6K1iQT6gpeaeueefP0nS2DMs/1V3x1TV/k6MVhiDoOygrrowEAx0/J5KykrzH5hzyQVH5IX5hL0k+MV6hvnnUy6ZpquZ+Xxn";
    const plain = decryptEvent(aesKey, encrypt);
    const event = JSON.parse(plain) as {
      eventType: string;
      eventData: { notify: string; from: string };
    };
    expect(event.eventType).toBe("IM_P2P_TO_ROBOT_MSG");
    expect(event.eventData.notify).toBe("哈喽");
    expect(event.eventData.from).toBe("liuyuyang03@corp.netease.com");
  });
});
