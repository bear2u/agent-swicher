import { handleList } from "./src/commands/list.mjs";
import { handleCurrent } from "./src/commands/current.mjs";
import { handleSwitch } from "./src/commands/switch.mjs";
import { handleAdd } from "./src/commands/add.mjs";
import { handleLogin } from "./src/commands/login.mjs";
import { handleRename } from "./src/commands/rename.mjs";
import { handleRemove } from "./src/commands/remove.mjs";
import { handleStatus } from "./src/commands/status.mjs";
import { c } from "./src/ui.mjs";

const VERSION = "0.2.18";

export function printHelp() {
  console.log(`
${c.bold}Agent Switcher CLI${c.reset} v${VERSION}
A command-line multi-account manager for OpenAI Codex CLI

${c.bold}USAGE:${c.reset}
  codex-switch <command> [arguments] [options]
  codex-switch <account-name>           ${c.dim}# Quick switch${c.reset}
  codex-switch                          ${c.dim}# Interactive selection (TTY)${c.reset}

${c.bold}COMMANDS:${c.reset}
  ${c.cyan}list, ls${c.reset}                       List all registered accounts
  ${c.cyan}current, whoami${c.reset}                Display the currently active account
  ${c.cyan}switch, use <name|index>${c.reset}       Switch active account (updates ~/.codex/auth.json)
  ${c.cyan}login [name]${c.reset}                   Log in to a new account with ChatGPT OAuth
  ${c.cyan}add <name> [options]${c.reset}           Add an account manually
  ${c.cyan}rename <name|index> <new-name>${c.reset} Rename an existing account
  ${c.cyan}remove, rm, delete <name>${c.reset}      Delete an account from the store
  ${c.cyan}status, doctor${c.reset}                 Check auth file, store, and running processes
  ${c.cyan}help, --help, -h${c.reset}               Show this help message

${c.bold}OPTIONS FOR 'add':${c.reset}
  --api-key <key>              Add account with an OpenAI API key
  --from-auth <file>           Import account from an existing auth.json file
  --from-current               Import current active ~/.codex/auth.json
  --switch, -s                 Switch to the newly added account immediately

${c.bold}GLOBAL OPTIONS:${c.reset}
  --force, -f                  Force switch even if Codex processes are active
  --json                       Output result in JSON format (for list, current, status)
  --yes, -y                    Skip confirmation prompts (for remove)
  --version, -v                Print version information

${c.bold}EXAMPLES:${c.reset}
  codex-switch list
  codex-switch switch work
  codex-switch 2
  codex-switch login personal
  codex-switch add my-api --api-key sk-...
  codex-switch add default --from-current
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--force" || arg === "-f") {
      flags.force = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--switch" || arg === "-s") {
      flags.switch = true;
    } else if (arg === "--from-current") {
      flags.fromCurrent = true;
    } else if (arg === "--api-key") {
      flags.apiKey = argv[++i];
    } else if (arg === "--from-auth") {
      flags.fromAuth = argv[++i];
    } else if (arg === "--version" || arg === "-v") {
      console.log(`codex-switch v${VERSION}`);
      return;
    } else if (arg === "--help" || arg === "-h" || arg === "help") {
      printHelp();
      return;
    } else {
      args.push(arg);
    }
  }

  const command = args[0];

  switch (command) {
    case "list":
    case "ls":
      handleList(flags);
      break;

    case "current":
    case "whoami":
      handleCurrent(flags);
      break;

    case "switch":
    case "use":
      await handleSwitch(args[1], flags);
      break;

    case "login":
      await handleLogin(args[1], flags);
      break;

    case "add":
      handleAdd(args[1], flags);
      break;

    case "rename":
      handleRename(args[1], args[2]);
      break;

    case "remove":
    case "rm":
    case "delete":
      await handleRemove(args[1], flags);
      break;

    case "status":
    case "doctor":
      handleStatus(flags);
      break;

    default:
      if (!command) {
        // If no argument and TTY, run interactive switch, otherwise show help
        if (process.stdin.isTTY) {
          await handleSwitch(null, flags);
        } else {
          printHelp();
        }
      } else {
        // If command is not recognized, treat it as a shorthand for switch <name>!
        // E.g.: `codex-switch work` or `codex-switch 2`
        await handleSwitch(command, flags);
      }
      break;
  }
}
