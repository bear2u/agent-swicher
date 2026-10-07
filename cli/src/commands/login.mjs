import { loadAccounts, saveAccounts, writeCurrentAuth } from "../storage.mjs";
import { loginWithChatGPT } from "../oauth.mjs";
import { badgeForPlan, c } from "../ui.mjs";

export async function handleLogin(name, options = {}) {
  const store = loadAccounts(false);

  console.log(`\n${c.bold}Starting ChatGPT OAuth Login...${c.reset}`);
  console.log(`A browser window should open automatically.`);

  let account;
  try {
    account = await loginWithChatGPT(name, {
      openBrowser: options.openBrowser !== false,
      onAuthUrl: (url) => {
        console.log(`\nIf the browser does not open automatically, visit:\n${c.cyan}${url}${c.reset}\n`);
        console.log(`Waiting for login in browser... (Press Ctrl+C to cancel)`);
      },
    });
  } catch (err) {
    console.error(`\n${c.red}Login failed: ${err.message}${c.reset}`);
    process.exit(1);
  }

  // Check if an account with this ID or email already exists, update it if so
  const existingIdx = store.accounts.findIndex(
    (a) =>
      a.id === account.id ||
      (account.email && a.email && a.email.toLowerCase() === account.email.toLowerCase()) ||
      a.name.toLowerCase() === account.name.toLowerCase()
  );

  if (existingIdx !== -1) {
    account.id = store.accounts[existingIdx].id;
    store.accounts[existingIdx] = account;
    console.log(`\n${c.green}✓ Updated existing account credentials:${c.reset} ${account.name}`);
  } else {
    store.accounts.push(account);
    console.log(`\n${c.green}✓ Logged in as new account:${c.reset} ${account.name}`);
  }

  // Switch to newly logged in account by default
  store.active_account_id = account.id;
  account.last_used_at = new Date().toISOString();
  saveAccounts(store);
  writeCurrentAuth(account);

  const badge = badgeForPlan(account.plan_type, account.auth_mode);
  console.log(`${c.cyan}Set as active account:${c.reset} ${account.name} ${badge}\n`);
}
