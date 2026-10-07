import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAccountFromAuthJson,
  findAccount,
  loadAccounts,
  saveAccounts,
  syncActiveAccountTokens,
  writeCurrentAuth,
} from "../src/storage.mjs";

test("createAccountFromAuthJson handles API key format", () => {
  const account = createAccountFromAuthJson("my-api", {
    OPENAI_API_KEY: "sk-test-12345",
  });

  assert.equal(account.name, "my-api");
  assert.equal(account.auth_mode, "api_key");
  assert.equal(account.auth_data.key, "sk-test-12345");
});

test("findAccount finds by name, id, index and email", () => {
  const store = {
    version: 1,
    accounts: [
      {
        id: "id-1",
        name: "Personal",
        email: "personal@test.com",
        plan_type: "plus",
        auth_mode: "chat_g_p_t",
      },
      {
        id: "id-2",
        name: "Work",
        email: "work@corp.com",
        plan_type: "team",
        auth_mode: "chat_g_p_t",
      },
    ],
    active_account_id: "id-1",
  };

  assert.equal(findAccount(store, "id-2")?.name, "Work");
  assert.equal(findAccount(store, "work")?.name, "Work");
  assert.equal(findAccount(store, "WORK")?.name, "Work");
  assert.equal(findAccount(store, "work@corp.com")?.name, "Work");
  assert.equal(findAccount(store, "1")?.name, "Personal");
  assert.equal(findAccount(store, "2")?.name, "Work");
  assert.equal(findAccount(store, "99"), null);
});

test("isolated storage test with custom CODEX_HOME and CODEX_SWITCHER_CONFIG_DIR", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  const originalCodexHome = process.env.CODEX_HOME;
  const originalConfigDir = process.env.CODEX_SWITCHER_CONFIG_DIR;

  try {
    process.env.CODEX_HOME = path.join(tempDir, ".codex");
    process.env.CODEX_SWITCHER_CONFIG_DIR = path.join(tempDir, ".codex-switcher");

    // 1. Initial load should return empty store
    const store = loadAccounts(false);
    assert.equal(store.accounts.length, 0);

    // 2. Add an account
    const acc = {
      id: "test-id",
      name: "Test Account",
      email: "test@example.com",
      plan_type: "plus",
      subscription_expires_at: null,
      auth_mode: "api_key",
      auth_data: { type: "api_key", key: "sk-abc" },
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    store.accounts.push(acc);
    store.active_account_id = acc.id;
    saveAccounts(store);

    // 3. Write auth
    writeCurrentAuth(acc);

    const authFile = path.join(process.env.CODEX_HOME, "auth.json");
    assert.equal(fs.existsSync(authFile), true);
    const authContent = JSON.parse(fs.readFileSync(authFile, "utf8"));
    assert.equal(authContent.OPENAI_API_KEY, "sk-abc");

    // 4. Reload store and verify persistence
    const reloaded = loadAccounts(false);
    assert.equal(reloaded.accounts.length, 1);
    assert.equal(reloaded.accounts[0].name, "Test Account");
  } finally {
    if (originalCodexHome) {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    if (originalConfigDir) {
      process.env.CODEX_SWITCHER_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.CODEX_SWITCHER_CONFIG_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
