import assert from "node:assert/strict";
import test from "node:test";
import { claudeStatus, claudeUsage, type ClaudeAccount } from "../src/lib/claude.ts";

const account: ClaudeAccount = {
  number: 1, email: "test@example.com", alias: "", organizationName: "", organizationUuid: "",
  active: true, usageStatus: "ok", usageFetchedAt: null, lastGoodFetchedAt: null, lastGoodUsage: null,
  usage: { fiveHour: { pct: 0, resetsAt: "2026-10-07T10:00:00Z" }, sevenDay: { pct: 100, resetsAt: null } },
};

test("Claude quota preserves zero and full usage with correct window lengths", () => {
  const usage = claudeUsage(account);
  assert.equal(usage.primary_used_percent, 0);
  assert.equal(usage.secondary_used_percent, 100);
  assert.equal(usage.primary_window_minutes, 300);
  assert.equal(usage.secondary_window_minutes, 10080);
  assert.equal(usage.primary_resets_at, Date.parse("2026-10-07T10:00:00Z") / 1000);
  assert.equal(usage.credits_balance, null);
});

test("missing usage stays unknown, never appears as zero consumption", () => {
  const usage = claudeUsage({ ...account, usage: null });
  assert.equal(usage.primary_used_percent, null);
  assert.equal(usage.secondary_used_percent, null);
});

test("expired account can display last known usage while requiring login renewal", () => {
  const expired = { ...account, usage: null, lastGoodUsage: account.usage, usageStatus: "relogin_required" };
  assert.equal(claudeUsage(expired).secondary_used_percent, 100);
  assert.match(claudeStatus(expired.usageStatus)!, /Sign in again/);
  assert.equal(claudeStatus("ok"), null);
});

test("invalid reset times and unknown statuses are handled", () => {
  assert.equal(claudeUsage({ ...account, usage: { fiveHour: { pct: 20, resetsAt: "invalid" }, sevenDay: null } }).primary_resets_at, null);
  assert.match(claudeStatus("future_status")!, /unavailable/);
});
