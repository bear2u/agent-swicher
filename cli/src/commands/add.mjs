import fs from "node:fs";
import {
  createAccountFromAuthJson,
  loadAccounts,
  readCurrentAuth,
  saveAccounts,
  writeCurrentAuth,
} from "../storage.mjs";
import { badgeForPlan, c } from "../ui.mjs";

export function handleAdd(name, options = {}) {
  const store = loadAccounts(false);
  const trimmedName = name?.trim();

  if (!trimmedName) {
    console.error(`${c.red}Account name is required.${c.reset}`);
    console.error(`Usage: codex-switch add <name> [--api-key <key> | --from-auth <file> | --from-current]`);
    process.exit(1);
  }

  // Check duplicate name
  if (store.accounts.some((a) => a.name.toLowerCase() === trimmedName.toLowerCase())) {
    console.error(`${c.red}An account named '${trimmedName}' already exists.${c.reset}`);
    process.exit(1);
  }

  let newAccount = null;

  if (options.apiKey) {
    newAccount = {
      id: crypto.randomUUID(),
      name: trimmedName,
      email: null,
      plan_type: null,
      subscription_expires_at: null,
      auth_mode: "api_key",
      auth_data: {
        type: "api_key",
        key: options.apiKey.trim(),
      },
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
  } else if (options.fromAuth) {
    if (!fs.existsSync(options.fromAuth)) {
      console.error(`${c.red}Auth file does not exist: ${options.fromAuth}${c.reset}`);
      process.exit(1);
    }
    try {
      const content = JSON.parse(fs.readFileSync(options.fromAuth, "utf8"));
      newAccount = createAccountFromAuthJson(trimmedName, content);
    } catch (err) {
      console.error(`${c.red}Failed to read auth file: ${err.message}${c.reset}`);
      process.exit(1);
    }
  } else if (options.fromCurrent) {
    const current = readCurrentAuth();
    if (!current) {
      console.error(`${c.red}No existing ~/.codex/auth.json found to import.${c.reset}`);
      process.exit(1);
    }
    newAccount = createAccountFromAuthJson(trimmedName, current);
  } else {
    console.error(
      `${c.red}Please specify an auth source: --api-key <key>, --from-auth <file>, or --from-current.${c.reset}`
    );
    console.error(`Or use ${c.cyan}codex-switch login [name]${c.reset} for ChatGPT OAuth login.`);
    process.exit(1);
  }

  if (!newAccount) {
    console.error(`${c.red}Could not construct valid account credentials.${c.reset}`);
    process.exit(1);
  }

  store.accounts.push(newAccount);

  // If first account or --switch flag provided
  if (store.accounts.length === 1 || options.switch) {
    store.active_account_id = newAccount.id;
    newAccount.last_used_at = new Date().toISOString();
    writeCurrentAuth(newAccount);
  }

  saveAccounts(store);

  const badge = badgeForPlan(newAccount.plan_type, newAccount.auth_mode);
  console.log(
    `\n${c.green}✓ Added account:${c.reset} ${c.bold}${newAccount.name}${c.reset} ${badge}`
  );
  if (store.active_account_id === newAccount.id) {
    console.log(`${c.cyan}Set as active account.${c.reset}`);
  }
}
