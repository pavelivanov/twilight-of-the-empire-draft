import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyTelegramInitData } from "./auth.js";

const botToken = "123456:test-token";
const now = new Date("2026-07-31T10:00:00.000Z").getTime();

function signedInitData(authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAEAAAE",
    user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada_table" }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  it("accepts valid, recent init data", () => {
    const user = verifyTelegramInitData(signedInitData(now / 1_000), botToken, 60, now);
    expect(user).toMatchObject({ id: 42, first_name: "Ada", username: "ada_table" });
  });

  it("rejects tampering", () => {
    const params = new URLSearchParams(signedInitData(now / 1_000));
    params.set("user", JSON.stringify({ id: 99, first_name: "Mallory" }));
    expect(() => verifyTelegramInitData(params.toString(), botToken, 60, now)).toThrow(
      "Telegram authentication data is invalid",
    );
  });

  it("rejects expired init data", () => {
    expect(() => verifyTelegramInitData(signedInitData(now / 1_000 - 61), botToken, 60, now)).toThrow(
      "Telegram authentication data has expired",
    );
  });
});
