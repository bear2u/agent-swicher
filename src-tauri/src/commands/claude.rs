//! Claude Code accounts are owned by claude-swap, never the Codex auth store.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{process::Command, sync::Mutex};

static CLAUDE_OPERATION: Mutex<()> = Mutex::const_new(());
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeWindow {
    pub pct: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    pub five_hour: Option<ClaudeWindow>,
    pub seven_day: Option<ClaudeWindow>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccount {
    pub number: u32,
    pub email: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default)]
    pub organization_name: String,
    #[serde(default)]
    pub organization_uuid: String,
    pub active: bool,
    pub usage_status: String,
    pub usage: Option<ClaudeUsage>,
    pub usage_fetched_at: Option<String>,
    pub last_good_usage: Option<ClaudeUsage>,
    pub last_good_fetched_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccounts {
    pub installed: bool,
    pub accounts: Vec<ClaudeAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListEnvelope {
    schema_version: u32,
    accounts: Vec<ClaudeAccount>,
}

fn executable() -> Option<PathBuf> {
    let name = if cfg!(windows) { "cswap.exe" } else { "cswap" };
    let mut directories = Vec::new();
    // Finder-launched apps do not inherit a login shell's PATH.
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join(".local/bin"));
        directories.push(home.join(".cargo/bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path).filter(|p| p.is_absolute()));
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    directories
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}

async fn run(exe: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new(exe);
    command.args(args).stdin(Stdio::null()).kill_on_drop(true);
    // Always operate on the normal Claude profile, even if launched from a
    // cswap session shell. No shell parsing or user-controlled command flags.
    command
        .env_remove("CLAUDE_CONFIG_DIR")
        .env_remove("CLAUDE_CONFIG_PATH");
    command.env("NO_COLOR", "1");
    let output = tokio::time::timeout(TIMEOUT, command.output()).await
        .map_err(|_| "Claude request timed out. Refresh accounts before retrying; the operation may have completed.".to_string())?
        .map_err(|_| "Could not start claude-swap. Reinstall it with: uv tool install --upgrade claude-swap".to_string())?;
    if !output.status.success() {
        // Never forward arbitrary subprocess output: it may contain credentials.
        return Err(match args.first().copied() {
            Some("add") => "Could not save the current Claude login. Sign in to Claude Code with /login, then retry. Check that macOS Keychain is unlocked.",
            Some("switch") => "Claude account switch failed. The login may need renewal, Keychain may be locked, or an account session may still be running. Refresh and try again.",
            _ => "Could not load Claude accounts. Check Keychain access and update claude-swap (0.26.0 or newer).",
        }.into());
    }
    Ok(output.stdout)
}

fn parse_accounts(bytes: &[u8]) -> Result<Vec<ClaudeAccount>, String> {
    let envelope: ListEnvelope = serde_json::from_slice(bytes)
        .map_err(|_| "Unexpected claude-swap response. Update claude-swap to a compatible version (0.26.0 or newer).".to_string())?;
    if envelope.schema_version != 1 {
        return Err("Unsupported claude-swap JSON schema. Update Codex Switcher.".into());
    }
    Ok(envelope.accounts)
}

async fn list(exe: &Path) -> Result<Vec<ClaudeAccount>, String> {
    parse_accounts(&run(exe, &["list", "--json"]).await?)
}

#[tauri::command]
pub async fn list_claude_accounts() -> Result<ClaudeAccounts, String> {
    let _guard = CLAUDE_OPERATION.lock().await;
    let Some(exe) = executable() else {
        return Ok(ClaudeAccounts {
            installed: false,
            accounts: vec![],
        });
    };
    Ok(ClaudeAccounts {
        installed: true,
        accounts: list(&exe).await?,
    })
}

#[tauri::command]
pub async fn add_claude_account() -> Result<(), String> {
    let _guard = CLAUDE_OPERATION.lock().await;
    let exe = executable().ok_or("Install claude-swap first.")?;
    // No --slot: cswap allocates a new slot, or refreshes the same identity.
    run(&exe, &["add"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn switch_claude_account(
    number: u32,
    email: String,
    organization_uuid: String,
) -> Result<(), String> {
    let _guard = CLAUDE_OPERATION.lock().await;
    let exe = executable().ok_or("Install claude-swap first.")?;
    switch_with_executable(&exe, number, &email, &organization_uuid).await
}

async fn switch_with_executable(
    exe: &Path,
    number: u32,
    email: &str,
    organization_uuid: &str,
) -> Result<(), String> {
    let accounts = list(exe).await?;
    // Slots can be reassigned outside this app. Reject a stale card.
    let account = accounts
        .iter()
        .find(|a| {
            a.number == number && a.email == email && a.organization_uuid == organization_uuid
        })
        .ok_or("This Claude account changed. Refresh the list before switching.")?;
    if account.active {
        return Ok(());
    }
    let output = run(exe, &["switch", &number.to_string(), "--json"]).await?;
    let value: serde_json::Value = serde_json::from_slice(&output)
        .map_err(|_| "Invalid switch response. Refresh accounts to check the active login.")?;
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1)
        || value.get("switched").and_then(|v| v.as_bool()) != Some(true)
    {
        return Err(
            "Claude did not confirm a switch. Refresh accounts to check the active login.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_empty_and_rejects_unknown_schema() {
        assert!(parse_accounts(br#"{"schemaVersion":1,"accounts":[]}"#)
            .unwrap()
            .is_empty());
        assert!(parse_accounts(br#"{"schemaVersion":2,"accounts":[]}"#).is_err());
        assert!(parse_accounts(b"not json").is_err());
    }

    #[test]
    fn projects_usage_without_exposing_unknown_secret_fields() {
        let accounts = parse_accounts(br#"{"schemaVersion":1,"accounts":[{"number":2,"email":"test@example.com","active":false,"usageStatus":"token_expired","usage":null,"lastGoodUsage":{"fiveHour":{"pct":42,"resetsAt":"2026-10-07T10:00:00Z"},"sevenDay":null},"accessToken":"SECRET"}]}"#).unwrap();
        assert_eq!(
            accounts[0]
                .last_good_usage
                .as_ref()
                .unwrap()
                .five_hour
                .as_ref()
                .unwrap()
                .pct,
            42.0
        );
        assert!(!serde_json::to_string(&accounts).unwrap().contains("SECRET"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn switches_only_the_selected_identity_and_skips_active_accounts() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("cswap-fixture-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, r##"#!/bin/sh
case "$1" in
list)
  [ "$2" = "--json" ] || exit 1
  echo '{"schemaVersion":1,"accounts":[{"number":1,"email":"active@example.com","active":true,"usageStatus":"ok","usage":null},{"number":2,"email":"target@example.com","organizationUuid":"org-2","active":false,"usageStatus":"ok","usage":null}]}'
  ;;
switch)
  [ "$2" = "2" ] && [ "$3" = "--json" ] || exit 1
  echo '{"schemaVersion":1,"switched":true,"to":{"number":2,"email":"target@example.com"}}'
  ;;
*) exit 1 ;;
esac
"##).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let stale = switch_with_executable(&path, 2, "old@example.com", "org-2").await;
        let wrong_org = switch_with_executable(&path, 2, "target@example.com", "other-org").await;
        let active = switch_with_executable(&path, 1, "active@example.com", "").await;
        let switched = switch_with_executable(&path, 2, "target@example.com", "org-2").await;
        std::fs::remove_file(&path).unwrap();
        assert!(stale.unwrap_err().contains("changed"));
        assert!(wrong_org.unwrap_err().contains("changed"));
        assert!(active.is_ok());
        assert!(switched.is_ok());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runner_has_no_stdin_and_does_not_leak_failure_output() {
        // Test subprocess contract without invoking cswap or reading real accounts.
        assert!(run(Path::new("/usr/bin/true"), &[])
            .await
            .unwrap()
            .is_empty());
        let error = run(Path::new("/bin/sh"), &["-c", "echo SECRET >&2; exit 1"])
            .await
            .unwrap_err();
        assert!(!error.contains("SECRET"));
    }
}
