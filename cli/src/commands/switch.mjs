import {
  findAccount,
  loadAccounts,
  readCurrentAuth,
  saveAccounts,
  syncActiveAccountTokens,
  writeCurrentAuth,
} from "../storage.mjs";
import { checkCodexProcesses } from "../process.mjs";
import { badgeForPlan, c, promptQuestion } from "../ui.mjs";

export async function handleSwitch(targetIdentifier, options = {}) {
  const store = loadAccounts(true);
  const accounts = store.accounts || [];

  if (accounts.length === 0) {
    console.error(`${c.red}No accounts available to switch.${c.reset}`);
    process.exit(1);
  }

  let selectedAccount = null;

  // 1. If target identifier provided, find account
  if (targetIdentifier) {
    selectedAccount = findAccount(store, targetIdentifier);
    if (!selectedAccount) {
      console.error(`${c.red}Account '${targetIdentifier}' not found.${c.reset}`);
      console.error(`Run ${c.cyan}codex-switch list${c.reset} to see available accounts.`);
      process.exit(1);
    }
  } else {
    // 2. Interactive selection if no argument given
    if (!process.stdin.isTTY) {
      console.error(`${c.red}Please specify an account name, email, or index.${c.reset}`);
      console.error(`Usage: codex-switch switch <account>`);
      process.exit(1);
    }

    console.log(`\n${c.bold}Select an account to switch to:${c.reset}\n`);
    accounts.forEach((acc, idx) => {
      const isActive = acc.id === store.active_account_id;
      const marker = isActive ? `${c.cyan}* ` : "  ";
      const badge = badgeForPlan(acc.plan_type, acc.auth_mode);
      const email = acc.email ? `(${acc.email})` : "";
      console.log(`${marker}[${idx + 1}] ${acc.name} ${badge} ${c.dim}${email}${c.reset}`);
    });

    const choice = await promptQuestion(`\nEnter number (1-${accounts.length}): `);
    const num = parseInt(choice, 10);
    if (Number.isNaN(num) || num < 1 || num > accounts.length) {
      console.error(`${c.red}Invalid selection.${c.reset}`);
      process.exit(1);
    }
    selectedAccount = accounts[num - 1];
  }

  if (selectedAccount.id === store.active_account_id) {
    console.log(`${c.yellow}Account '${selectedAccount.name}' is already active.${c.reset}`);
    return;
  }

  // Check for running codex processes
  const procInfo = checkCodexProcesses();
  if (procInfo.count > 0 && !options.force) {
    console.log(
      `${c.yellow}Warning: ${procInfo.count} Codex process(es) currently running (PID: ${procInfo.pids.join(
        ", "
      )}).${c.reset}`
    );
    console.log(`${c.dim}Active sessions may lock or overwrite ~/.codex/auth.json.${c.reset}`);

    if (process.stdin.isTTY) {
      const answer = await promptQuestion("Continue switching anyway? [y/N]: ");
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Switch cancelled.");
        return;
      }
    } else {
      console.error(
        `${c.red}Cannot switch while Codex is running. Use --force to override.${c.reset}`
      );
      process.exit(1);
    }
  }

  // 1. Sync tokens of the CURRENT active account before switching away
  const currentAuth = readCurrentAuth();
  if (currentAuth) {
    syncActiveAccountTokens(store, currentAuth);
  }

  // 2. Write new credentials into ~/.codex/auth.json
  writeCurrentAuth(selectedAccount);

  // 3. Update store active ID and timestamp
  selectedAccount.last_used_at = new Date().toISOString();
  store.active_account_id = selectedAccount.id;
  saveAccounts(store);

  const badge = badgeForPlan(selectedAccount.plan_type, selectedAccount.auth_mode);
  const emailInfo = selectedAccount.email ? ` (${selectedAccount.email})` : "";

  console.log(
    `\n${c.green}✓ Successfully switched to:${c.reset} ${c.bold}${selectedAccount.name}${c.reset} ${badge}${emailInfo}\n`
  );
}
