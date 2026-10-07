import { loadAccounts } from "../storage.mjs";
import { badgeForPlan, c, formatTimeAgo } from "../ui.mjs";

export function handleList(options = {}) {
  const store = loadAccounts(true);
  const accounts = store.accounts || [];

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          active_account_id: store.active_account_id,
          accounts: accounts.map((a, idx) => ({
            index: idx + 1,
            id: a.id,
            name: a.name,
            email: a.email,
            plan_type: a.plan_type,
            auth_mode: a.auth_mode,
            is_active: a.id === store.active_account_id,
            subscription_expires_at: a.subscription_expires_at,
            last_used_at: a.last_used_at,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (accounts.length === 0) {
    console.log(`${c.yellow}No accounts registered yet.${c.reset}`);
    console.log(`Use ${c.cyan}codex-switch login [name]${c.reset} or ${c.cyan}codex-switch add${c.reset} to add an account.`);
    return;
  }

  console.log(`\n${c.bold}Codex Accounts (${accounts.length})${c.reset}\n`);

  accounts.forEach((account, idx) => {
    const isActive = account.id === store.active_account_id;
    const activeMarker = isActive ? `${c.cyan}${c.bold}* ` : "  ";
    const num = `${c.dim}${String(idx + 1).padStart(2)}.${c.reset}`;
    const name = isActive ? `${c.bold}${c.cyan}${account.name}${c.reset}` : `${c.bold}${account.name}${c.reset}`;
    const badge = badgeForPlan(account.plan_type, account.auth_mode);
    const email = account.email ? `${c.dim}(${account.email})${c.reset}` : "";
    const lastUsed = account.last_used_at ? `${c.dim}[used ${formatTimeAgo(account.last_used_at)}]${c.reset}` : "";

    console.log(`${activeMarker}${num} ${name} ${badge} ${email} ${lastUsed}`);
  });

  console.log(`\n${c.dim}* = active account in ~/.codex/auth.json${c.reset}\n`);
}
