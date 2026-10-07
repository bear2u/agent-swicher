import { execSync } from "node:child_process";

/**
 * Check if Codex CLI or desktop processes are currently active.
 * Returns { count: number, pids: number[], canSwitch: boolean }
 */
export function checkCodexProcesses() {
  const isWindows = process.platform === "win32";
  const pids = [];

  if (isWindows) {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq codex.exe" /FO CSV /NH', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of output.split("\n")) {
        const match = line.match(/"codex\.exe","(\d+)"/i);
        if (match) {
          pids.push(parseInt(match[1], 10));
        }
      }
    } catch {
      // Ignore tasklist failure
    }
  } else {
    try {
      const output = execSync("ps -axo pid=,tty=,command=", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const currentPid = process.pid;

      for (const rawLine of output.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;

        const pid = parseInt(parts[0], 10);
        if (Number.isNaN(pid) || pid === currentPid) continue;

        const command = parts.slice(2).join(" ");
        const lower = command.toLowerCase();

        // Skip switcher itself
        if (lower.includes("codex-switcher") || lower.includes("codex-switch")) {
          continue;
        }

        const firstToken = parts[2];
        const isCodexCli = firstToken === "codex" || firstToken.endsWith("/codex");
        const isCodexDesktop =
          lower.includes("codex.app/contents/macos/codex") ||
          (lower.includes("openai.codex") && !lower.includes("helper"));

        if (isCodexCli || isCodexDesktop) {
          pids.push(pid);
        }
      }
    } catch {
      // Ignore ps failure
    }
  }

  return {
    count: pids.length,
    pids,
    canSwitch: pids.length === 0,
  };
}
