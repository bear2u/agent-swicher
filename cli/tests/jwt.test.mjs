import assert from "node:assert/strict";
import test from "node:test";
import { parseChatGptIdTokenClaims } from "../src/jwt.mjs";

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

test("parseChatGptIdTokenClaims extracts email and plan_type", () => {
  const token = makeJwt({
    email: "test@example.com",
    "https://api.openai.com/auth": {
      chatgpt_plan_type: "plus",
      chatgpt_account_id: "acct-12345678",
      chatgpt_subscription_active_until: "2026-10-01T00:00:00Z",
    },
  });

  const claims = parseChatGptIdTokenClaims(token);
  assert.equal(claims.email, "test@example.com");
  assert.equal(claims.plan_type, "plus");
  assert.equal(claims.account_id, "acct-12345678");
  assert.equal(claims.subscription_expires_at, "2026-10-01T00:00:00.000Z");
});

test("parseChatGptIdTokenClaims handles missing or invalid tokens safely", () => {
  assert.deepEqual(parseChatGptIdTokenClaims(null), {
    email: null,
    plan_type: null,
    account_id: null,
    subscription_expires_at: null,
  });

  assert.deepEqual(parseChatGptIdTokenClaims("invalid.token"), {
    email: null,
    plan_type: null,
    account_id: null,
    subscription_expires_at: null,
  });

  assert.deepEqual(parseChatGptIdTokenClaims("a.b.c"), {
    email: null,
    plan_type: null,
    account_id: null,
    subscription_expires_at: null,
  });
});
