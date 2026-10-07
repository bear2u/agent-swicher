import { useCallback, useEffect, useRef, useState } from "react";
import { invokeBackend } from "../lib/platform";

interface Profile { id: string; name: string; savedAt: string; current: boolean }
interface DesktopState { supported: boolean; installed: boolean; hasCurrentLogin: boolean; profiles: Profile[]; recoveryAvailable: boolean }
type Action = "save" | "add" | "switch" | "restore" | "open";
const button = "rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

export function ClaudeDesktopPanel() {
  const [data, setData] = useState<DesktopState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);

  const execute = useCallback(async (action?: Action, accountId?: string, label?: string) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const next = action
        ? await invokeBackend<DesktopState>("claude_desktop_action", { action, accountId: accountId ?? null, name: label ?? null })
        : await invokeBackend<DesktopState>("list_claude_desktop_accounts");
      if (!mounted.current) return;
      setData(next);
      if (action) {
        setConfirmAdd(false);
        const messages: Record<Action, string> = {
          save: "Desktop login saved. Claude has reopened. You can now add another account.",
          add: "The previous login is saved. Sign in to the other account inside Claude, then return here, select Refresh and save its login.",
          switch: "Claude reopened with the selected saved login. If Claude asks you to sign in again, renew that login and save it here.",
          restore: "The previous login was restored and Claude reopened.",
          open: "Claude opened. Sign in there, then return here, select Refresh and save the desktop login.",
        };
        setMessage(messages[action]);
        if (action === "save" || action === "add") setName("");
      }
    } catch (err) {
      if (mounted.current) setError(String(err));
      // A failed action may leave a durable recovery snapshot. Expose it now.
      if (action) {
        try {
          const next = await invokeBackend<DesktopState>("list_claude_desktop_accounts");
          if (mounted.current) setData(next);
        } catch { /* Keep the original operation error visible. */ }
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true; void execute();
    return () => { mounted.current = false; };
  }, [execute]);

  const blocked = busy || !!data?.recoveryAvailable;
  return <section aria-labelledby="claude-desktop-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 id="claude-desktop-heading" className="text-xl font-bold">Claude desktop accounts</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Save a login from the Claude app and switch accounts with an app restart.</p>
      </div>
      <button className={button} disabled={busy} onClick={() => void execute()}>{busy ? "Working…" : "Refresh"}</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
    {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">{message}</div>}
    {!data && !error && <p role="status" className="py-8 text-gray-500">Checking Claude Desktop…</p>}
    {data && !data.supported && <p>Claude desktop switching is currently available on macOS. Use the Claude Code CLI tab on this platform.</p>}
    {data?.supported && !data.installed && <p>Install Claude Desktop in your Applications folder, open it and sign in, then select Refresh.</p>}
    {data?.supported && data.installed && <>
      {data.recoveryAvailable && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30">
        <h2 className="font-semibold">A previous switch was interrupted</h2>
        <p className="text-sm">Restore the previous login before saving or switching accounts. Claude will close and reopen.</p>
        <button className={button} disabled={busy} onClick={() => void execute("restore")}>Restore previous login</button>
      </div>}
      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="font-semibold">{data.hasCurrentLogin ? "Save the current desktop login" : "Sign in inside the Claude app"}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Use Google or email sign-in in Claude. Each account needs its first login there; then select Refresh here before saving. A CLI login is not required.</p>
        <label className="block text-sm font-medium" htmlFor="desktop-account-name">Account name (optional)</label>
        <input id="desktop-account-name" maxLength={80} value={name} disabled={blocked} onChange={e => setName(e.target.value)} placeholder="Personal or Work" className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-700" />
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={() => void execute("open")}>Open Claude</button>
          <button className={button} disabled={blocked || !data.hasCurrentLogin} onClick={() => void execute("save", undefined, name)}>Save desktop login</button>
          <button className={button} disabled={blocked || !data.hasCurrentLogin} onClick={() => setConfirmAdd(true)}>Add another account</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Saving and switching close and reopen Claude. Finish any running work first. Your chats and app settings stay in place.</p>
        {confirmAdd && <div className="space-y-3 rounded-xl border border-orange-200 p-4 dark:border-orange-800">
          <h3 className="font-semibold">Open a fresh login in Claude?</h3>
          <p className="text-sm">Your current login will be saved before Claude reopens on its sign-in screen. Complete the new login there, then save it here. You can switch back to the saved account at any time.</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={blocked} onClick={() => void execute("add", undefined, name)}>Save current &amp; add another</button>
            <button className={button} disabled={busy} onClick={() => setConfirmAdd(false)}>Cancel</button>
          </div>
        </div>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.profiles.map(profile => <article key={profile.id} className={`space-y-3 rounded-2xl border bg-white p-5 dark:bg-gray-900 ${profile.current ? "border-orange-400" : "border-gray-200 dark:border-gray-700"}`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 break-words font-semibold">{profile.name}</h2>
            {profile.current && <span className="shrink-0 rounded-md bg-orange-50 px-2 py-1 text-xs text-orange-700 dark:bg-orange-950 dark:text-orange-300">Current login</span>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Saved {new Date(profile.savedAt).toLocaleString()}</p>
          <button className={button} disabled={blocked || profile.current} onClick={() => void execute("switch", profile.id)}>{profile.current ? "Selected account" : "Switch & restart Claude"}</button>
        </article>)}
      </div>
      {data.profiles.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No desktop logins saved yet. Save your current login to get started.</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">Desktop logins are stored locally on this Mac. CLI accounts and usage are managed separately in the Claude Code CLI tab. A saved login may need renewal when it expires.</p>
    </>}
  </section>;
}
