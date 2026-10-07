# Codex Switcher CLI

A lightweight, zero-dependency command-line multi-account manager for OpenAI Codex CLI. It seamlessly shares state and accounts with the Codex Switcher desktop app (`~/.codex-switcher/accounts.json`) and manages `~/.codex/auth.json`.

## Features

- ⚡ **Instant Account Switching**: Switch Codex accounts by name or index (`codex-switch 2` or `codex-switch work`).
- 🔄 **Safe Token Sync**: Automatically preserves and syncs refreshed OAuth tokens back to `accounts.json` before switching.
- 🛡️ **Active Process Guard**: Detects running Codex CLI sessions or Desktop app instances to prevent accidental credential corruption.
- 🔐 **ChatGPT OAuth & API Key Support**: Log in with ChatGPT OAuth straight from the terminal or add API keys.
- 🌐 **100% Interoperable**: Fully compatible with Codex Switcher Desktop App & Tray menu.
- 📦 **Zero External Dependencies**: Powered by pure Node.js built-ins.

---

## Installation & Setup

### Option 1: Global symlink (Recommended)

Link `codex-switch` into your `~/.local/bin` (or `/usr/local/bin`):

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/cli/bin/codex-switch" ~/.local/bin/codex-switch
```

Then you can run `codex-switch` anywhere in your terminal!

### Option 2: Run via pnpm

```bash
pnpm cli list
pnpm cli switch <name>
```

---

## Commands & Usage

### 1. List Accounts

```bash
codex-switch list
# or shorthand:
codex-switch ls
```

Output:
```
Codex Accounts (3)

*  1. Work-A [team] (work-a@example.com) [used 5m ago]
   2. Work-B [team] (work-b@example.com) [used 1h ago]
   3. Personal-Pro [Pro] (personal@example.com) [used 2d ago]
```

### 2. Switch Account

```bash
# Switch by name:
codex-switch switch work

# Switch by index:
codex-switch 2

# Quick switch (shorthand):
codex-switch personal

# Interactive picker:
codex-switch
```

### 3. Check Current Account

```bash
codex-switch current
# or shorthand:
codex-switch whoami
```

### 4. Login with ChatGPT OAuth

Opens your browser to authenticate with OpenAI and registers the account directly into Codex Switcher:

```bash
codex-switch login <account-name>
```

### 5. Add Account Manually

```bash
# Add with API key:
codex-switch add my-api --api-key sk-proj-...

# Import current ~/.codex/auth.json:
codex-switch add backup-account --from-current

# Import from a specific auth.json file:
codex-switch add team-account --from-auth /path/to/auth.json
```

### 6. Rename Account

```bash
codex-switch rename "old-name" "new-name"
```

### 7. Remove Account

```bash
codex-switch remove <name|index>
```

### 8. Health & Environment Status

```bash
codex-switch status
# or shorthand:
codex-switch doctor
```

---

## JSON Output

All read commands support `--json` for shell scripting or piping into `jq`:

```bash
codex-switch list --json | jq .
codex-switch current --json
codex-switch status --json
```
