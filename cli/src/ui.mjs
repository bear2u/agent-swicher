import readline from "node:readline/promises";

const isColorSupported =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

export const c = {
  reset: isColorSupported ? "\x1b[0m" : "",
  bold: isColorSupported ? "\x1b[1m" : "",
  dim: isColorSupported ? "\x1b[2m" : "",
  italic: isColorSupported ? "\x1b[3m" : "",
  underline: isColorSupported ? "\x1b[4m" : "",

  black: isColorSupported ? "\x1b[30m" : "",
  red: isColorSupported ? "\x1b[31m" : "",
  green: isColorSupported ? "\x1b[32m" : "",
  yellow: isColorSupported ? "\x1b[33m" : "",
  blue: isColorSupported ? "\x1b[34m" : "",
  magenta: isColorSupported ? "\x1b[35m" : "",
  cyan: isColorSupported ? "\x1b[36m" : "",
  white: isColorSupported ? "\x1b[37m" : "",

  bgGreen: isColorSupported ? "\x1b[42m\x1b[30m" : "",
  bgCyan: isColorSupported ? "\x1b[46m\x1b[30m" : "",
  bgYellow: isColorSupported ? "\x1b[43m\x1b[30m" : "",
};

export function badgeForPlan(planType, authMode) {
  if (authMode === "ApiKey" || authMode === "api_key") {
    return `${c.yellow}[API Key]${c.reset}`;
  }
  if (!planType) {
    return `${c.dim}[ChatGPT]${c.reset}`;
  }
  const lower = planType.toLowerCase();
  if (lower.includes("pro")) {
    return `${c.bold}${c.magenta}[Pro]${c.reset}`;
  }
  if (lower.includes("team") || lower.includes("enterprise") || lower.includes("business")) {
    return `${c.bold}${c.blue}[${planType}]${c.reset}`;
  }
  if (lower.includes("plus")) {
    return `${c.bold}${c.green}[Plus]${c.reset}`;
  }
  return `${c.dim}[${planType}]${c.reset}`;
}

export function formatTimeAgo(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Ask a question using readline.
 */
export async function promptQuestion(questionText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(questionText);
    return answer.trim();
  } finally {
    rl.close();
  }
}
