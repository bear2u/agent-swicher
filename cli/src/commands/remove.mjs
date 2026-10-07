import { findAccount, loadAccounts, saveAccounts, writeCurrentAuth } from "../storage.mjs";
import { c, promptQuestion } from "../ui.mjs";

export async function handleRemove(identifier, options = {}) {
  const store = loadAccounts(false);

  if (!identifier) {
    console.error(`${c.red}Account identifier is required.${c.reset}`);
    console.error(`Usage: codex-switch remove <name|index> [-y]`);
    process.exit(1);
  }

  const account = findAccount(store, identifier);
  if (!account) {
    console.error(`${c.red}Account '${identifier}' not found.${c.reset}`);
    process.exit(1);
  }

  if (!options.yes && process.stdin.isTTY) {
    const answer = await promptQuestion(
      `Are you sure you want to remove account '${account.name}'? [y/N]: `
    );
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.log("Operation cancelled.");
      return;
    }
  }

  const removedName = account.name;
  const wasActive = store.active_account_id === account.id;

  store.accounts = store.accounts.filter((a) => a.id !== account.id);

  if (wasActive) {
    if (store.accounts.length > 0) {
      const nextActive = store.accounts[0];
      store.active_account_id = nextActive.id;
      writeCurrentAuth(nextActive);
      console.log(`${c.yellow}Active account was removed. Switched to '${nextActive.name}'.${c.reset}`);
    } else {
      store.active_account_id = null;
    }
  }

  saveAccounts(store);
  console.log(`\n${c.green}✓ Removed account:${c.reset} ${removedName}\n`);
}
