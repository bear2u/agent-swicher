import path from "node:path";
import os from "node:os";

/**
 * Get the Codex home directory (~/.codex or $CODEX_HOME).
 */
export function getCodexHome() {
  if (process.env.CODEX_HOME) {
    return path.resolve(process.env.CODEX_HOME);
  }
  return path.join(os.homedir(), ".codex");
}

/**
 * Get the official auth.json path (~/.codex/auth.json).
 */
export function getCodexAuthFile() {
  return path.join(getCodexHome(), "auth.json");
}

/**
 * Get the codex-switcher config directory (~/.codex-switcher).
 */
export function getSwitcherConfigDir() {
  if (process.env.CODEX_SWITCHER_CONFIG_DIR) {
    return path.resolve(process.env.CODEX_SWITCHER_CONFIG_DIR);
  }
  return path.join(os.homedir(), ".codex-switcher");
}

/**
 * Get the accounts.json path (~/.codex-switcher/accounts.json).
 */
export function getAccountsFile() {
  return path.join(getSwitcherConfigDir(), "accounts.json");
}

/**
 * Get settings.json path (~/.codex-switcher/settings.json).
 */
export function getSettingsFile() {
  return path.join(getSwitcherConfigDir(), "settings.json");
}
