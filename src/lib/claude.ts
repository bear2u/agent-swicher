import type { UsageInfo } from "../types";

export interface ClaudeUsageWindow { pct: number; resetsAt: string | null }
export interface ClaudeUsage { fiveHour: ClaudeUsageWindow | null; sevenDay: ClaudeUsageWindow | null }
export interface ClaudeAccount {
  number: number;
  email: string;
  alias: string;
  organizationName: string;
  organizationUuid: string;
  active: boolean;
  usageStatus: string;
  usage: ClaudeUsage | null;
  usageFetchedAt: string | null;
  lastGoodUsage: ClaudeUsage | null;
  lastGoodFetchedAt: string | null;
}
export interface ClaudeAccounts { installed: boolean; accounts: ClaudeAccount[] }

function resetTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export function claudeUsage(account: ClaudeAccount): UsageInfo {
  const usage = account.usage ?? account.lastGoodUsage;
  return {
    account_id: `claude:${account.number}`,
    plan_type: null,
    primary_used_percent: usage?.fiveHour?.pct ?? null,
    primary_window_minutes: 300,
    primary_resets_at: resetTimestamp(usage?.fiveHour?.resetsAt),
    secondary_used_percent: usage?.sevenDay?.pct ?? null,
    secondary_window_minutes: 10080,
    secondary_resets_at: resetTimestamp(usage?.sevenDay?.resetsAt),
    has_credits: null, unlimited_credits: null, credits_balance: null, error: null,
  };
}

export function claudeStatus(status: string): string | null {
  switch (status) {
    case "ok": return null;
    case "token_expired": return "Login expired. Use this account in Claude Code to renew it, or sign in again and save the login.";
    case "relogin_required": return "Sign in again with /login, then save the current login.";
    case "api_key": return "API key account: subscription quota is unavailable.";
    case "no_credentials": return "No saved credentials. Sign in and save the current login.";
    case "keychain_unavailable": return "Unlock Keychain and retry.";
    default: return "Current usage is unavailable. Refresh to try again.";
  }
}
