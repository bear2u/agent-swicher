import { loadAccounts, readCurrentAuth } from "../storage.mjs";
import { getCodexAuthFile } from "../config.mjs";
import { badgeForPlan, c, formatTimeAgo } from "../ui.mjs";

export function handleCurrent(options = {}) {
  const store = loadAccounts(true);
  const activeId = store.active_account_id;
  const account = store.accounts.find((a) => a.id === activeId);
  const currentAuth = readCurrentAuth();

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          active_account: account || null,
          has_auth_file: Boolean(currentAuth),
          auth_file_path: getCodexAuthFile(),
        },
        null,
        2
      )
    );
    return;
  }

  if (!account) {
    if (currentAuth) {
      console.log(`${c.yellow}Active account is not tracked in codex-switcher, but ~/.codex/auth.json exists.${c.reset}`);
      console.log(`Run ${c.cyan}codex-switch add <name> --from-current${c.reset} to register it.`);
    } else {
      console.log(`${c.yellow}No active account found and ~/.codex/auth.json does not exist.${c.reset}`);
    }
    return;
  }

  console.log(`\n${c.bold}Currently Active Account:${c.reset}`);
  console.log(`  Name:         ${c.bold}${c.cyan}${account.name}${c.reset}`);
  if (account.email) {
    console.log(`  Email:        ${account.email}`);
  }
  console.log(`  Auth Mode:    ${account.auth_mode}`);
  if (account.plan_type) {
    console.log(`  Plan:         ${badgeForPlan(account.plan_type, account.auth_mode)}`);
  }
  if (account.subscription_expires_at) {
    console.log(`  Expires:      ${new Date(account.subscription_expires_at).toLocaleString()}`);
  }
  if (account.last_used_at) {
    console.log(`  Last Used:    ${formatTimeAgo(account.last_used_at)} (${account.last_used_at})`);
  }
  console.log(`  Auth File:    ${c.dim}${getCodexAuthFile()}${c.reset}\n`);
}
