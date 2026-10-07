import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAccountsFile, getCodexAuthFile, getCodexHome, getSwitcherConfigDir } from "./config.mjs";
import { parseChatGptIdTokenClaims } from "./jwt.mjs";

/**
 * Creates an empty AccountsStore structure.
 */
export function createDefaultStore() {
  return {
    version: 1,
    accounts: [],
    active_account_id: null,
    masked_account_ids: [],
  };
}

/**
 * Reads current auth.json file if it exists.
 */
export function readCurrentAuth() {
  const authFile = getCodexAuthFile();
  if (!fs.existsSync(authFile)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(authFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Sync active account tokens from auth.json if refreshed by Codex CLI.
 */
export function syncActiveAccountTokens(store, auth) {
  if (!store || !store.active_account_id || !auth || !auth.tokens) {
    return false;
  }

  const account = store.accounts.find((a) => a.id === store.active_account_id);
  if (!account || !account.auth_data) {
    return false;
  }

  const isChatGpt =
    account.auth_mode === "chat_g_p_t" ||
    account.auth_mode === "ChatGPT" ||
    account.auth_data.type === "chat_g_p_t" ||
    Boolean(account.auth_data.ChatGPT);

  if (!isChatGpt) {
    return false;
  }

  const currentTokens = account.auth_data.ChatGPT || account.auth_data;
  const newTokens = auth.tokens;

  const changed =
    currentTokens.id_token !== newTokens.id_token ||
    currentTokens.access_token !== newTokens.access_token ||
    currentTokens.refresh_token !== newTokens.refresh_token ||
    (newTokens.account_id && currentTokens.account_id !== newTokens.account_id);

  if (changed) {
    currentTokens.id_token = newTokens.id_token;
    currentTokens.access_token = newTokens.access_token;
    currentTokens.refresh_token = newTokens.refresh_token;
    if (newTokens.account_id) {
      currentTokens.account_id = newTokens.account_id;
    }

    const claims = parseChatGptIdTokenClaims(newTokens.id_token);
    if (claims.email) account.email = claims.email;
    if (claims.plan_type) account.plan_type = claims.plan_type;
    if (claims.subscription_expires_at) {
      account.subscription_expires_at = claims.subscription_expires_at;
    }
    return true;
  }

  return false;
}

/**
 * Loads the accounts store from disk. If store does not exist but ~/.codex/auth.json exists,
 * automatically imports it as the initial account.
 */
export function loadAccounts(autoImportCurrent = true) {
  const file = getAccountsFile();
  let store = null;

  if (fs.existsSync(file)) {
    try {
      const content = fs.readFileSync(file, "utf8");
      store = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse accounts file (${file}): ${err.message}`);
    }
  }

  if (!store) {
    store = createDefaultStore();
  }

  // Check if we should auto-import existing ~/.codex/auth.json
  if (autoImportCurrent && store.accounts.length === 0) {
    const currentAuth = readCurrentAuth();
    if (currentAuth) {
      const imported = createAccountFromAuthJson("default", currentAuth);
      if (imported) {
        store.accounts.push(imported);
        store.active_account_id = imported.id;
        saveAccounts(store);
      }
    }
  }

  // Always attempt to sync tokens for the active account
  const currentAuth = readCurrentAuth();
  if (currentAuth && syncActiveAccountTokens(store, currentAuth)) {
    saveAccounts(store);
  }

  return store;
}

/**
 * Saves the accounts store to disk with restrictive 0600 permissions.
 */
export function saveAccounts(store) {
  const file = getAccountsFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const content = JSON.stringify(store, null, 2);
  fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
}

/**
 * Writes the specified account's credentials into ~/.codex/auth.json.
 */
export function writeCurrentAuth(account) {
  const codexHome = getCodexHome();
  if (!fs.existsSync(codexHome)) {
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  }

  const isApiKey =
    account.auth_mode === "api_key" ||
    account.auth_mode === "ApiKey" ||
    account.auth_data?.type === "api_key" ||
    Boolean(account.auth_data?.ApiKey);

  const isChatGpt =
    account.auth_mode === "chat_g_p_t" ||
    account.auth_mode === "ChatGPT" ||
    account.auth_data?.type === "chat_g_p_t" ||
    Boolean(account.auth_data?.ChatGPT);

  let authPayload;
  if (isApiKey) {
    const key =
      account.auth_data.key ||
      account.auth_data.ApiKey?.key ||
      account.auth_data.apiKey;
    authPayload = {
      OPENAI_API_KEY: key,
    };
  } else if (isChatGpt) {
    const chatGpt = account.auth_data.ChatGPT || account.auth_data;
    authPayload = {
      tokens: {
        id_token: chatGpt.id_token,
        access_token: chatGpt.access_token,
        refresh_token: chatGpt.refresh_token,
        account_id: chatGpt.account_id || null,
      },
      last_refresh: new Date().toISOString(),
    };
  } else {
    throw new Error(`Unsupported account auth mode: ${account.auth_mode}`);
  }

  const authFile = getCodexAuthFile();
  fs.writeFileSync(authFile, JSON.stringify(authPayload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Create a StoredAccount object from an auth.json structure.
 */
export function createAccountFromAuthJson(accountName, authJson) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const apiKey = authJson.OPENAI_API_KEY || authJson.openai_api_key;
  if (apiKey) {
    const resolvedName = accountName?.trim() || "API key account";
    return {
      id,
      name: resolvedName,
      email: null,
      plan_type: null,
      subscription_expires_at: null,
      auth_mode: "api_key",
      auth_data: {
        type: "api_key",
        key: apiKey,
      },
      created_at: now,
      last_used_at: now,
    };
  }

  if (authJson.tokens) {
    const tokens = authJson.tokens;
    const claims = parseChatGptIdTokenClaims(tokens.id_token);
    let resolvedName = accountName?.trim();
    if (!resolvedName) {
      if (claims.email) {
        resolvedName = claims.email;
      } else if (claims.account_id || tokens.account_id) {
        const accId = claims.account_id || tokens.account_id;
        const suffix = accId.slice(-8);
        resolvedName = `ChatGPT account (${suffix})`;
      } else {
        resolvedName = "ChatGPT account";
      }
    }

    return {
      id,
      name: resolvedName,
      email: claims.email,
      plan_type: claims.plan_type,
      subscription_expires_at: claims.subscription_expires_at,
      auth_mode: "chat_g_p_t",
      auth_data: {
        type: "chat_g_p_t",
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        account_id: claims.account_id || tokens.account_id || null,
      },
      created_at: now,
      last_used_at: now,
    };
  }

  return null;
}

/**
 * Find an account in the store by name, ID, or 1-based index.
 */
export function findAccount(store, identifier) {
  if (!store || !store.accounts || store.accounts.length === 0) {
    return null;
  }

  const trimmed = String(identifier).trim();

  // 1. Match by exact ID
  let match = store.accounts.find((a) => a.id === trimmed);
  if (match) return match;

  // 2. Match by exact name (case-sensitive, then case-insensitive)
  match = store.accounts.find((a) => a.name === trimmed);
  if (match) return match;
  match = store.accounts.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;

  // 3. Match by email
  match = store.accounts.find((a) => a.email && a.email.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;

  // 4. Match by 1-based index
  const index = parseInt(trimmed, 10);
  if (!Number.isNaN(index) && index >= 1 && index <= store.accounts.length) {
    return store.accounts[index - 1];
  }

  return null;
}
