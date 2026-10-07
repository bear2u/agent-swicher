import { findAccount, loadAccounts, saveAccounts } from "../storage.mjs";
import { c } from "../ui.mjs";

export function handleRename(oldIdentifier, newName) {
  const store = loadAccounts(false);
  const trimmedNewName = newName?.trim();

  if (!oldIdentifier || !trimmedNewName) {
    console.error(`${c.red}Both current identifier and new name are required.${c.reset}`);
    console.error(`Usage: codex-switch rename <current-name|index> <new-name>`);
    process.exit(1);
  }

  const account = findAccount(store, oldIdentifier);
  if (!account) {
    console.error(`${c.red}Account '${oldIdentifier}' not found.${c.reset}`);
    process.exit(1);
  }

  // Check if new name conflicts with another account
  const conflict = store.accounts.find(
    (a) => a.id !== account.id && a.name.toLowerCase() === trimmedNewName.toLowerCase()
  );
  if (conflict) {
    console.error(`${c.red}An account named '${trimmedNewName}' already exists.${c.reset}`);
    process.exit(1);
  }

  const prevName = account.name;
  account.name = trimmedNewName;
  saveAccounts(store);

  console.log(
    `\n${c.green}✓ Renamed account:${c.reset} '${prevName}' -> ${c.bold}${trimmedNewName}${c.reset}\n`
  );
}
