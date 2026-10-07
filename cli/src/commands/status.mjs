import fs from "node:fs";
import { getAccountsFile, getCodexAuthFile, getCodexHome } from "../config.mjs";
import { loadAccounts, readCurrentAuth } from "../storage.mjs";
import { checkCodexProcesses } from "../process.mjs";
import { badgeForPlan, c } from "../ui.mjs";

export function handleStatus(options = {}) {
  const authFile = getCodexAuthFile();
  const accountsFile = getAccountsFile();
  const authExists = fs.existsSync(authFile);
  const currentAuth = readCurrentAuth();
  const procInfo = checkCodexProcesses();

  let store = null;
  let storeError = null;
  try {
    store = loadAccounts(false);
  } catch (err) {
    storeError = err.message;
  }

  const activeAccount = store?.accounts?.find((a) => a.id === store.active_account_id);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          auth_file: {
            path: authFile,
            exists: authExists,
            has_credentials: Boolean(currentAuth?.tokens || currentAuth?.OPENAI_API_KEY || currentAuth?.openai_api_key),
            auth_type: currentAuth?.tokens ? "ChatGPT" : currentAuth ? "ApiKey" : null,
          },
          switcher_store: {
            path: accountsFile,
            exists: fs.existsSync(accountsFile),
            total_accounts: store?.accounts?.length || 0,
            active_account: activeAccount ? activeAccount.name : null,
            error: storeError,
          },
          processes: {
            running_codex_count: procInfo.count,
            pids: procInfo.pids,
          },
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`\n${c.bold}Agent Switcher Environment Status${c.reset}\n`);

  // 1. ~/.codex/auth.json
  console.log(`${c.bold}Codex CLI Auth:${c.reset}`);
  console.log(`  File:      ${authFile}`);
  if (!authExists) {
    console.log(`  Status:    ${c.yellow}Missing (not logged in)${c.reset}`);
  } else if (!currentAuth) {
    console.log(`  Status:    ${c.red}Invalid / Unreadable JSON${c.reset}`);
  } else if (currentAuth.tokens) {
    console.log(`  Status:    ${c.green}Active (ChatGPT OAuth)${c.reset}`);
  } else if (currentAuth.OPENAI_API_KEY || currentAuth.openai_api_key) {
    console.log(`  Status:    ${c.green}Active (API Key)${c.reset}`);
  } else {
    console.log(`  Status:    ${c.yellow}Empty credentials${c.reset}`);
  }

  // 2. ~/.codex-switcher/accounts.json
  console.log(`\n${c.bold}Agent Switcher Store:${c.reset}`);
  console.log(`  File:      ${accountsFile}`);
  if (storeError) {
    console.log(`  Status:    ${c.red}Error: ${storeError}${c.reset}`);
  } else if (!fs.existsSync(accountsFile)) {
    console.log(`  Status:    ${c.dim}Not initialized yet (will initialize on first run)${c.reset}`);
  } else {
    console.log(`  Accounts:  ${store.accounts.length} registered`);
    if (activeAccount) {
      const badge = badgeForPlan(activeAccount.plan_type, activeAccount.auth_mode);
      console.log(`  Active:    ${c.cyan}${activeAccount.name}${c.reset} ${badge}`);
    } else {
      console.log(`  Active:    ${c.dim}None${c.reset}`);
    }
  }

  // 3. Process detection
  console.log(`\n${c.bold}Process Status:${c.reset}`);
  if (procInfo.count === 0) {
    console.log(`  Codex App: ${c.green}Idle (0 running instances)${c.reset}`);
  } else {
    console.log(
      `  Codex App: ${c.yellow}${procInfo.count} instance(s) running (PID: ${procInfo.pids.join(", ")})${c.reset}`
    );
  }

  console.log("");
}
