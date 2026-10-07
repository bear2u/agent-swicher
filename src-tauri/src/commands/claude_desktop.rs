//! Same-machine Claude Desktop login snapshots. Never reads/decrypts token values
//! for display or merges conversation history between accounts.
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const AUTH_KEYS: [&str; 3] = [
    "oauth:tokenCache",
    "oauth:tokenCacheV2",
    "lastKnownAccountUuid",
];
const COOKIE_NAMES: [&str; 4] = ["Cookies", "Cookies-journal", "Cookies-wal", "Cookies-shm"];
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_SNAPSHOT: u64 = 384 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    version: u32,
    account_id: Option<String>,
    name: String,
    saved_at: String,
    auth: Map<String, Value>,
    cookie_layout: String,
    cookies: BTreeMap<String, Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProfile {
    id: String,
    name: String,
    saved_at: String,
    current: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    supported: bool,
    installed: bool,
    has_current_login: bool,
    profiles: Vec<DesktopProfile>,
    recovery_available: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAction {
    Save,
    Add,
    Switch,
    Restore,
    Open,
}

struct Store {
    desktop: PathBuf,
    root: PathBuf,
}

fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Could not create the private Claude profile folder.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not restrict profile folder permissions.")?;
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid profile path.")?;
    let tmp = parent.join(format!(".agent-switcher-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|_| "Could not create a private temporary file.")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save Claude login data.")?;
        fs::rename(&tmp, path).map_err(|_| "Could not replace Claude login data atomically.")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Could not read Claude login data.")?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("Unsupported Claude login file type or size. No switch was performed.".into());
    }
    fs::read(path).map_err(|_| "Could not read Claude login data.".into())
}

fn config(path: &Path) -> Result<Map<String, Value>, String> {
    serde_json::from_slice::<Value>(&read_limited(path, MAX_FILE)?)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .ok_or("Claude config is invalid or has changed format. No switch was performed.".into())
}

fn identity(auth: &Map<String, Value>) -> Option<String> {
    let id = auth.get("lastKnownAccountUuid")?.as_str()?;
    if uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    let token = auth.get("oauth:tokenCacheV2")?.as_str()?;
    if token.is_empty() {
        return None;
    }
    Some(id.to_string())
}

impl Store {
    fn local() -> Result<Self, String> {
        if !cfg!(target_os = "macos") {
            return Err("Claude Desktop switching is currently available on macOS.".into());
        }
        let home = dirs::home_dir().ok_or("Could not locate your home folder.")?;
        Ok(Self {
            desktop: home.join("Library/Application Support/Claude"),
            root: home.join(".codex-switcher/claude-desktop"),
        })
    }
    fn lock(&self) -> Result<File, String> {
        private_dir(&self.root)?;
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(self.root.join("operation.lock"))
            .map_err(|_| "Could not lock Claude profiles.")?;
        file.try_lock_exclusive()
            .map_err(|_| "Another Claude Desktop operation is in progress. Try again shortly.")?;
        Ok(file)
    }
    fn layout(&self) -> Result<String, String> {
        let root = self.desktop.join("Cookies").is_file();
        let network = self.desktop.join("Network/Cookies").is_file();
        match (root, network) {
            (true, false) => Ok("root".into()),
            (false, true) => Ok("network".into()),
            (false, false) => Ok("root".into()),
            _ => Err("Multiple Claude cookie stores found. This layout needs verification before switching.".into()),
        }
    }
    fn cookie_dir(&self, layout: &str) -> Result<PathBuf, String> {
        match layout {
            "root" => Ok(self.desktop.clone()),
            "network" => Ok(self.desktop.join("Network")),
            _ => Err("Unsupported saved cookie layout.".into()),
        }
    }
    fn capture(&self, name: &str) -> Result<Snapshot, String> {
        let cfg = config(&self.desktop.join("config.json"))?;
        let auth: Map<_, _> = AUTH_KEYS
            .iter()
            .filter_map(|k| cfg.get(*k).map(|v| ((*k).into(), v.clone())))
            .collect();
        if identity(&auth).is_none()
            && auth
                .values()
                .any(|v| !v.is_null() && v.as_str() != Some(""))
        {
            return Err("Claude login is incomplete or has changed format. Sign in inside Claude before switching.".into());
        }
        let layout = self.layout()?;
        let mut cookies = BTreeMap::new();
        for name in COOKIE_NAMES {
            let path = self.cookie_dir(&layout)?.join(name);
            let bytes = if path
                .try_exists()
                .map_err(|_| "Could not inspect Claude cookies.")?
            {
                Some(STANDARD.encode(read_limited(&path, MAX_FILE)?))
            } else {
                None
            };
            cookies.insert(name.into(), bytes);
        }
        Ok(Snapshot {
            version: 1,
            account_id: identity(&auth),
            name: name.into(),
            saved_at: chrono::Utc::now().to_rfc3339(),
            auth,
            cookie_layout: layout,
            cookies,
        })
    }
    fn validate(snapshot: &Snapshot) -> Result<(), String> {
        if snapshot.version != 1
            || !["root", "network"].contains(&snapshot.cookie_layout.as_str())
            || snapshot.cookies.len() != COOKIE_NAMES.len()
            || snapshot
                .auth
                .keys()
                .any(|k| !AUTH_KEYS.contains(&k.as_str()))
            || snapshot.account_id != identity(&snapshot.auth)
        {
            return Err("Saved Claude login has an unsupported format.".into());
        }
        for name in COOKIE_NAMES {
            let value = snapshot
                .cookies
                .get(name)
                .ok_or("Saved cookie snapshot is incomplete.")?;
            if let Some(encoded) = value {
                let bytes = STANDARD
                    .decode(encoded)
                    .map_err(|_| "Saved cookie snapshot is damaged.")?;
                if bytes.len() as u64 > MAX_FILE {
                    return Err("Saved cookie snapshot is too large.".into());
                }
            }
        }
        Ok(())
    }
    fn profile_path(&self, id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid Claude account identifier.")?;
        Ok(self.root.join(format!("{id}.json")))
    }
    fn read_snapshot(&self, path: &Path) -> Result<Snapshot, String> {
        let snapshot: Snapshot = serde_json::from_slice(&read_limited(path, MAX_SNAPSHOT)?)
            .map_err(|_| "Saved Claude login is damaged.")?;
        Self::validate(&snapshot)?;
        Ok(snapshot)
    }
    fn write_snapshot(&self, path: &Path, snapshot: &Snapshot) -> Result<(), String> {
        Self::validate(snapshot)?;
        atomic_write(
            path,
            &serde_json::to_vec(snapshot).map_err(|_| "Could not encode Claude login snapshot.")?,
        )
    }
    fn save_profile(&self, snapshot: &Snapshot, name: Option<&str>) -> Result<(), String> {
        let id = snapshot
            .account_id
            .as_deref()
            .ok_or("No desktop login found. Sign in inside the Claude app first.")?;
        let path = self.profile_path(id)?;
        let old_name = if path.exists() {
            Some(self.read_snapshot(&path)?.name)
        } else {
            None
        };
        let mut saved = snapshot.clone();
        saved.name = name
            .filter(|n| !n.trim().is_empty())
            .map(|n| n.trim().to_string())
            .or(old_name)
            .unwrap_or_else(|| format!("Claude account {}", &id[..8]));
        if saved.name.chars().count() > 80 {
            return Err("Account name must be at most 80 characters.".into());
        }
        self.write_snapshot(&path, &saved)
    }
    fn apply(&self, snapshot: &Snapshot) -> Result<(), String> {
        Self::validate(snapshot)?;
        let mut cfg = config(&self.desktop.join("config.json"))?;
        for key in AUTH_KEYS {
            cfg.remove(key);
        }
        cfg.extend(snapshot.auth.clone());
        let target = self.cookie_dir(&snapshot.cookie_layout)?;
        // Preserve directory permissions on the app's existing data directory.
        fs::create_dir_all(&target).map_err(|_| "Could not access the Claude cookie directory.")?;
        for layout in ["root", "network"] {
            let dir = self.cookie_dir(layout)?;
            for name in COOKIE_NAMES {
                let path = dir.join(name);
                let content = if layout == snapshot.cookie_layout {
                    snapshot.cookies.get(name).and_then(|v| v.as_ref())
                } else {
                    None
                };
                if let Some(encoded) = content {
                    let bytes = STANDARD
                        .decode(encoded)
                        .map_err(|_| "Saved cookie snapshot is damaged.")?;
                    atomic_write(&path, &bytes)?;
                } else if path
                    .try_exists()
                    .map_err(|_| "Could not inspect Claude cookies.")?
                {
                    fs::remove_file(&path)
                        .map_err(|_| "Could not replace Claude cookies. Close Claude and retry.")?;
                }
            }
        }
        atomic_write(
            &self.desktop.join("config.json"),
            &serde_json::to_vec_pretty(&cfg)
                .map_err(|_| "Could not encode Claude configuration.")?,
        )
    }
    fn state(&self, installed: bool) -> Result<DesktopState, String> {
        let active = if self.desktop.join("config.json").exists() {
            identity(&config(&self.desktop.join("config.json"))?)
        } else {
            None
        };
        let mut profiles = Vec::new();
        if self.root.exists() {
            for entry in fs::read_dir(&self.root).map_err(|_| "Could not list Claude profiles.")? {
                let path = entry.map_err(|_| "Could not read Claude profiles.")?.path();
                let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                if path.extension().and_then(|s| s.to_str()) != Some("json")
                    || uuid::Uuid::parse_str(id).is_err()
                {
                    continue;
                }
                let snapshot = self.read_snapshot(&path)?;
                if snapshot.account_id.as_deref() != Some(id) {
                    return Err("Saved Claude account identity does not match its profile.".into());
                }
                profiles.push(DesktopProfile {
                    id: id.into(),
                    name: snapshot.name,
                    saved_at: snapshot.saved_at,
                    current: active.as_deref() == Some(id),
                });
            }
        }
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(DesktopState {
            supported: true,
            installed,
            has_current_login: active.is_some(),
            profiles,
            recovery_available: self.root.join("recovery.json").is_file(),
        })
    }
}

trait DesktopRuntime {
    fn stop(&self) -> Result<(), String>;
    fn start(&self) -> Result<(), String>;
}

// A durable recovery marker is written before any login change. It is cleared
// only after the app restarts or rollback finishes; it also survives a crash.
fn transact(
    store: &Store,
    runtime: &impl DesktopRuntime,
    action: DesktopAction,
    id: Option<&str>,
    name: Option<&str>,
) -> Result<(), String> {
    if matches!(action, DesktopAction::Open) {
        return runtime.start();
    }
    let recovery = store.root.join("recovery.json");
    if matches!(action, DesktopAction::Restore) {
        let snapshot = store.read_snapshot(&recovery)?;
        runtime.stop()?;
        store.apply(&snapshot)?;
        runtime.start()?;
        fs::remove_file(recovery)
            .map_err(|_| "Restored the login, but could not clear the recovery marker.")?;
        return Ok(());
    }
    if recovery.exists() {
        return Err(
            "A previous switch was interrupted. Restore the previous login before continuing."
                .into(),
        );
    }
    let target = if matches!(action, DesktopAction::Switch) {
        let requested = id.ok_or("Choose a saved desktop account.")?;
        let snapshot = store.read_snapshot(&store.profile_path(requested)?)?;
        if snapshot.account_id.as_deref() != Some(requested) {
            return Err("Saved account identity mismatch.".into());
        }
        Some(snapshot)
    } else {
        None
    };
    // Validate the live format before asking Claude to close, then recapture
    // after a graceful shutdown so refreshed credentials and SQLite are flushed.
    store.capture("")?;
    runtime.stop()?;
    let before = match store.capture("") {
        Ok(s) => s,
        Err(e) => {
            let _ = runtime.start();
            return Err(e);
        }
    };
    let operation = (|| {
        if before.account_id.is_some() {
            store.save_profile(
                &before,
                if matches!(action, DesktopAction::Save | DesktopAction::Add) {
                    name
                } else {
                    None
                },
            )?;
        }
        if matches!(action, DesktopAction::Save) {
            if before.account_id.is_none() {
                return Err(
                    "No desktop login found. Sign in inside Claude, then save again.".into(),
                );
            }
            return runtime.start();
        }
        if let Some(ref target) = target {
            // The current profile was just freshened; do not restore its older snapshot.
            if target.account_id == before.account_id {
                return runtime.start();
            }
        }
        if matches!(action, DesktopAction::Add) && before.account_id.is_none() {
            return Err("Sign in inside Claude before adding another account.".into());
        }
        store.write_snapshot(&recovery, &before)?;
        if let Some(ref target) = target {
            store.apply(target)?;
        } else {
            let mut empty = before.clone();
            empty.account_id = None;
            empty.auth.clear();
            empty.cookies.values_mut().for_each(|value| *value = None);
            store.apply(&empty)?;
        }
        runtime.start()?;
        fs::remove_file(&recovery)
            .map_err(|_| "Claude opened, but the recovery marker could not be cleared.")?;
        Ok(())
    })();
    if let Err(error) = operation {
        if recovery.exists() {
            // Never restore files while a partly launched Claude is still writing.
            if runtime
                .stop()
                .and_then(|_| store.apply(&before))
                .and_then(|_| runtime.start())
                .is_err()
            {
                return Err(format!(
                    "{error} Automatic recovery could not finish. Use Restore previous login."
                ));
            }
            let _ = fs::remove_file(&recovery);
        } else {
            let _ = runtime.start();
        }
        return Err(error);
    }
    Ok(())
}

struct MacRuntime {
    app: PathBuf,
}
impl MacRuntime {
    fn installed() -> Option<Self> {
        let home = dirs::home_dir()?;
        [
            PathBuf::from("/Applications/Claude.app"),
            home.join("Applications/Claude.app"),
        ]
        .into_iter()
        .find(|p| p.join("Contents/MacOS/Claude").is_file())
        .map(|app| Self { app })
    }
    fn running(&self) -> Result<bool, String> {
        let output = std::process::Command::new("/bin/ps")
            .args(["-axo", "comm="])
            .output()
            .map_err(|_| "Could not check whether Claude is running.")?;
        if !output.status.success() {
            return Err("Could not check whether Claude is running.".into());
        }
        let prefix = format!("{}/Contents/", self.app.display());
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .any(|line| line.trim().starts_with(&prefix)))
    }
    fn command(program: &str, args: &[&std::ffi::OsStr]) -> Result<(), String> {
        use std::{
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not control the Claude desktop app.")?;
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(
                            "Claude did not accept the app operation. Close it manually and retry."
                                .into(),
                        )
                    }
                }
                Ok(None) if start.elapsed() < Duration::from_secs(20) => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Claude is waiting for attention. Finish or cancel its current task, then retry.".into());
                }
            }
        }
    }
}
impl DesktopRuntime for MacRuntime {
    fn stop(&self) -> Result<(), String> {
        if !self.running()? {
            return Ok(());
        }
        Self::command(
            "/usr/bin/osascript",
            &[
                "-e".as_ref(),
                "tell application id \"com.anthropic.claudefordesktop\" to quit".as_ref(),
            ],
        )?;
        for _ in 0..100 {
            if !self.running()? {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err("Claude is still running. Finish its work and quit it before switching. Login files were not changed.".into())
    }
    fn start(&self) -> Result<(), String> {
        Self::command("/usr/bin/open", &["-a".as_ref(), self.app.as_os_str()])?;
        for _ in 0..50 {
            if self.running()? {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err("Claude did not start. Use Restore previous login if recovery is offered.".into())
    }
}

#[tauri::command]
pub async fn list_claude_desktop_accounts() -> Result<DesktopState, String> {
    if !cfg!(target_os = "macos") {
        return Ok(DesktopState {
            supported: false,
            installed: false,
            has_current_login: false,
            profiles: vec![],
            recovery_available: false,
        });
    }
    tokio::task::spawn_blocking(|| {
        let store = Store::local()?;
        let _lock = store.lock()?;
        store.state(MacRuntime::installed().is_some())
    })
    .await
    .map_err(|_| "Claude Desktop operation could not finish.".to_string())?
}

#[tauri::command]
pub async fn claude_desktop_action(
    action: DesktopAction,
    account_id: Option<String>,
    name: Option<String>,
) -> Result<DesktopState, String> {
    tokio::task::spawn_blocking(move || {
        let store = Store::local()?;
        let _lock = store.lock()?;
        let runtime =
            MacRuntime::installed().ok_or("Install Claude Desktop in Applications first.")?;
        transact(
            &store,
            &runtime,
            action,
            account_id.as_deref(),
            name.as_deref(),
        )?;
        store.state(true)
    })
    .await
    .map_err(|_| "Claude Desktop operation could not finish.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    const A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    struct Fixture {
        dir: PathBuf,
        store: Store,
    }
    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("agent-desktop-test-{}", uuid::Uuid::new_v4()));
            let store = Store {
                desktop: dir.join("desktop"),
                root: dir.join("profiles"),
            };
            private_dir(&store.desktop).unwrap();
            private_dir(&store.root).unwrap();
            Self { dir, store }
        }
        fn login(&self, id: &str, token: &str, layout: &str) {
            let cfg = serde_json::json!({"lastKnownAccountUuid": id, "oauth:tokenCacheV2": token, "theme": "dark", "unrelated": {"keep": true}});
            atomic_write(
                &self.store.desktop.join("config.json"),
                &serde_json::to_vec(&cfg).unwrap(),
            )
            .unwrap();
            let path = self.store.cookie_dir(layout).unwrap();
            fs::create_dir_all(&path).unwrap();
            atomic_write(&path.join("Cookies"), token.as_bytes()).unwrap();
        }
        fn active(&self) -> Option<String> {
            identity(&config(&self.store.desktop.join("config.json")).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
    #[derive(Default)]
    struct Runtime {
        stops: Cell<usize>,
        starts: Cell<usize>,
        fail_stops: bool,
        fail_starts: Cell<usize>,
    }
    impl DesktopRuntime for Runtime {
        fn stop(&self) -> Result<(), String> {
            self.stops.set(self.stops.get() + 1);
            if self.fail_stops {
                Err("Still running".into())
            } else {
                Ok(())
            }
        }
        fn start(&self) -> Result<(), String> {
            self.starts.set(self.starts.get() + 1);
            let failures = self.fail_starts.get();
            if failures > 0 {
                self.fail_starts.set(failures - 1);
                Err("Start failed".into())
            } else {
                Ok(())
            }
        }
    }
    fn prepare() -> Fixture {
        let f = Fixture::new();
        f.login(B, "fake-token-b", "root");
        f.store
            .save_profile(&f.store.capture("").unwrap(), Some("Work"))
            .unwrap();
        f.login(A, "fake-token-a", "root");
        f
    }
    #[test]
    fn switching_preserves_settings_and_freshens_previous_login() {
        let f = prepare();
        transact(
            &f.store,
            &Runtime::default(),
            DesktopAction::Switch,
            Some(B),
            None,
        )
        .unwrap();
        assert_eq!(f.active().as_deref(), Some(B));
        assert_eq!(
            fs::read(f.store.desktop.join("Cookies")).unwrap(),
            b"fake-token-b"
        );
        let cfg = config(&f.store.desktop.join("config.json")).unwrap();
        assert_eq!(cfg["theme"], "dark");
        assert_eq!(cfg["unrelated"]["keep"], true);
        let saved = f
            .store
            .read_snapshot(&f.store.profile_path(A).unwrap())
            .unwrap();
        assert_eq!(saved.auth["oauth:tokenCacheV2"], "fake-token-a");
        assert!(!f.store.root.join("recovery.json").exists());
        let dto = serde_json::to_string(&f.store.state(true).unwrap()).unwrap();
        assert!(!dto.contains("fake-token"));
    }
    #[test]
    fn add_saves_previous_and_clears_only_auth_then_can_switch_back() {
        let f = prepare();
        let runtime = Runtime::default();
        transact(
            &f.store,
            &runtime,
            DesktopAction::Add,
            None,
            Some("Personal"),
        )
        .unwrap();
        assert_eq!(f.active(), None);
        assert!(!f.store.desktop.join("Cookies").exists());
        assert_eq!(
            config(&f.store.desktop.join("config.json")).unwrap()["theme"],
            "dark"
        );
        transact(&f.store, &runtime, DesktopAction::Switch, Some(A), None).unwrap();
        assert_eq!(f.active().as_deref(), Some(A));
        assert!(f
            .store
            .state(true)
            .unwrap()
            .profiles
            .iter()
            .any(|p| p.name == "Personal"));
    }
    #[test]
    fn failed_start_rolls_back_and_failed_recovery_leaves_marker() {
        let f = prepare();
        let runtime = Runtime {
            fail_starts: Cell::new(1),
            ..Default::default()
        };
        assert!(transact(&f.store, &runtime, DesktopAction::Switch, Some(B), None).is_err());
        assert_eq!(f.active().as_deref(), Some(A));
        assert!(!f.store.root.join("recovery.json").exists());
        runtime.fail_starts.set(2);
        assert!(
            transact(&f.store, &runtime, DesktopAction::Switch, Some(B), None)
                .unwrap_err()
                .contains("Automatic recovery")
        );
        assert!(f.store.root.join("recovery.json").exists());
        assert!(transact(&f.store, &runtime, DesktopAction::Save, None, None).is_err());
        transact(&f.store, &runtime, DesktopAction::Restore, None, None).unwrap();
        assert_eq!(f.active().as_deref(), Some(A));
        assert!(!f.store.root.join("recovery.json").exists());
    }
    #[test]
    fn shutdown_refusal_never_changes_login() {
        let f = prepare();
        let runtime = Runtime {
            fail_stops: true,
            ..Default::default()
        };
        assert!(transact(&f.store, &runtime, DesktopAction::Switch, Some(B), None).is_err());
        assert_eq!(f.active().as_deref(), Some(A));
        assert!(!f.store.profile_path(A).unwrap().exists());
    }
    #[test]
    fn same_account_keeps_rotated_tokens() {
        let f = prepare();
        f.store
            .save_profile(&f.store.capture("").unwrap(), Some("Personal"))
            .unwrap();
        f.login(A, "rotated-fake-token", "root");
        transact(
            &f.store,
            &Runtime::default(),
            DesktopAction::Switch,
            Some(A),
            None,
        )
        .unwrap();
        assert_eq!(
            config(&f.store.desktop.join("config.json")).unwrap()["oauth:tokenCacheV2"],
            "rotated-fake-token"
        );
    }
    #[test]
    fn network_layout_restores_sidecars_and_removes_stale_root_files() {
        let f = Fixture::new();
        f.login(A, "fake-token-a", "network");
        atomic_write(&f.store.desktop.join("Network/Cookies-wal"), b"fake-wal").unwrap();
        let snapshot = f.store.capture("").unwrap();
        fs::remove_dir_all(f.store.desktop.join("Network")).unwrap();
        f.login(B, "fake-token-b", "root");
        atomic_write(&f.store.desktop.join("Cookies-shm"), b"stale").unwrap();
        f.store.apply(&snapshot).unwrap();
        assert_eq!(
            fs::read(f.store.desktop.join("Network/Cookies-wal")).unwrap(),
            b"fake-wal"
        );
        assert!(!f.store.desktop.join("Cookies-shm").exists());
        assert!(!f.store.desktop.join("Cookies").exists());
    }
    #[test]
    fn unsupported_live_auth_and_corrupt_profiles_fail_before_shutdown() {
        let f = prepare();
        let runtime = Runtime::default();
        let mut cfg = config(&f.store.desktop.join("config.json")).unwrap();
        cfg.remove("oauth:tokenCacheV2");
        atomic_write(
            &f.store.desktop.join("config.json"),
            &serde_json::to_vec(&cfg).unwrap(),
        )
        .unwrap();
        assert!(transact(&f.store, &runtime, DesktopAction::Add, None, None).is_err());
        assert_eq!(runtime.stops.get(), 0);
        f.login(A, "fake-token", "root");
        atomic_write(&f.store.profile_path(B).unwrap(), b"broken").unwrap();
        assert!(transact(&f.store, &runtime, DesktopAction::Switch, Some(B), None).is_err());
        assert_eq!(runtime.stops.get(), 0);
        assert!(f.store.profile_path("../../secret").is_err());
    }
    #[test]
    fn private_files_and_exclusive_lock() {
        let f = prepare();
        let lock = f.store.lock().unwrap();
        assert!(f.store.lock().is_err());
        drop(lock);
        assert!(f.store.lock().is_ok());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&f.store.root).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(f.store.profile_path(B).unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
}
