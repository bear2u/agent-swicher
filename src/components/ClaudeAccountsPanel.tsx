import { useCallback, useEffect, useRef, useState } from "react";
import { invokeBackend } from "../lib/platform";
import { claudeStatus, claudeUsage, type ClaudeAccount, type ClaudeAccounts } from "../lib/claude";
import { ClaudeDesktopPanel } from "./ClaudeDesktopPanel";
import { UsageBar } from "./UsageBar";

const button = "rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

function ClaudeCodeAccountsPanel() {
  const [data, setData] = useState<ClaudeAccounts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);

  const execute = useCallback(async (action: string, account?: ClaudeAccount) => {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      if (action === "add") {
        await invokeBackend("add_claude_account");
        if (mounted.current) setMessage("Current Claude login saved. To add another account, sign in with /login and save again.");
      } else if (account) {
        await invokeBackend("switch_claude_account", {
          number: account.number, email: account.email, organizationUuid: account.organizationUuid,
        });
        if (mounted.current) setMessage(`Switched to ${account.alias || account.email}. On macOS, allow about 30 seconds for Claude Code to pick up the login, or reopen the session.`);
      }
      const next = await invokeBackend<ClaudeAccounts>("list_claude_accounts");
      if (mounted.current) setData(next);
    } catch (err) {
      if (mounted.current) setError(String(err));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void execute("refresh");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void execute("refresh");
    }, 120_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [execute]);

  return (
    <section aria-labelledby="claude-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="claude-heading" className="text-xl font-bold text-gray-900 dark:text-gray-100">Claude Code accounts</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage Claude logins and quota alongside your Codex accounts.</p>
        </div>
        <div className="flex gap-2">
          <button className={button} onClick={() => void execute("refresh")} disabled={!!busy}>{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
          {data?.installed && <button className={button} onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd}>Add account</button>}
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">{message}</div>}

      {data && !data.installed && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Set up Claude account switching</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Install claude-swap 0.26.0 or newer in a terminal, then select Refresh. Python 3.12 or newer is required.</p>
          <code className="my-4 block overflow-x-auto rounded-lg bg-gray-100 p-3 text-sm dark:bg-gray-800 dark:text-gray-100">uv tool install --upgrade claude-swap</code>
          <p className="text-sm text-gray-500 dark:text-gray-400">Already using pipx? Run <code>pipx install claude-swap</code>. Existing claude-swap accounts appear automatically.</p>
        </div>
      )}

      {data?.installed && (showAdd || data.accounts.length === 0) && (
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Save a Claude Code login</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <li>Open Claude Code in a terminal with <code>claude</code>.</li>
            <li>Use <code>/login</code> to sign in to the account you want to add.</li>
            <li>Return here and save the current login. Repeat for each account.</li>
          </ol>
          <p className="text-sm text-amber-700 dark:text-amber-300">Use /login directly when adding another account. /logout can revoke the previous account’s saved login.</p>
          <button className={button} disabled={!!busy} onClick={() => void execute("add")}>{busy === "add" ? "Saving…" : "Save current login"}</button>
          <p className="text-xs text-gray-500 dark:text-gray-400">Saving an existing account updates its credentials without creating a duplicate.</p>
        </div>
      )}

      {!data && !error && <p role="status" className="py-10 text-center text-gray-500">Loading Claude accounts…</p>}
      {data?.installed && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.accounts.map(account => {
            const status = claudeStatus(account.usageStatus);
            const measuredAt = account.usageFetchedAt ?? account.lastGoodFetchedAt;
            return (
              <article key={`${account.number}:${account.email}:${account.organizationUuid}`} className={`space-y-4 rounded-2xl border bg-white p-5 dark:bg-gray-900 ${account.active ? "border-orange-400 dark:border-orange-600" : "border-gray-200 dark:border-gray-700"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold text-gray-900 dark:text-gray-100">{account.alias || account.email}</h2>
                    {account.alias && <p className="break-all text-sm text-gray-500 dark:text-gray-400">{account.email}</p>}
                    <p className="text-xs text-gray-500 dark:text-gray-400">Account {account.number}{account.organizationName ? ` · ${account.organizationName}` : ""}</p>
                  </div>
                  {account.active && <span className="rounded-md bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300">Active</span>}
                </div>
                {status && <p className="text-sm text-amber-700 dark:text-amber-300">{status}</p>}
                {!account.usage && account.lastGoodUsage && <p className="text-xs text-gray-500 dark:text-gray-400">Last known usage · may be out of date</p>}
                <UsageBar usage={claudeUsage(account)} />
                {measuredAt && Number.isFinite(Date.parse(measuredAt)) && <p className="text-xs text-gray-500 dark:text-gray-400">Measured {new Date(measuredAt).toLocaleString()}</p>}
                <button className={button} disabled={!!busy || account.active} onClick={() => void execute(`switch:${account.number}`, account)}>
                  {account.active ? "Current account" : busy === `switch:${account.number}` ? "Switching…" : "Switch account"}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">For Claude Code CLI and the VS Code extension. Each service keeps its own active account. Usage refreshes every two minutes while this tab is visible; cached readings may be older.</p>
    </section>
  );
}


export function ClaudeAccountsPanel() {
  const [mode, setMode] = useState<"desktop" | "cli">("desktop");
  return <div className="space-y-5">
    <nav aria-label="Claude application" className="flex gap-2">
      <button className={`${button} aria-pressed:border-orange-400 aria-pressed:bg-orange-50 dark:aria-pressed:bg-orange-950`} aria-pressed={mode === "desktop"} onClick={() => setMode("desktop")}>Claude app</button>
      <button className={`${button} aria-pressed:border-orange-400 aria-pressed:bg-orange-50 dark:aria-pressed:bg-orange-950`} aria-pressed={mode === "cli"} onClick={() => setMode("cli")}>Claude Code CLI</button>
    </nav>
    {mode === "desktop" ? <ClaudeDesktopPanel /> : <ClaudeCodeAccountsPanel />}
  </div>;
}
