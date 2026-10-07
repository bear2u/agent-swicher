import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { parseChatGptIdTokenClaims } from "./jwt.mjs";

const DEFAULT_ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const BASE_PORT = 1455;
const MAX_PORT_ATTEMPTS = 10;

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePkce() {
  const verifierBytes = crypto.randomBytes(64);
  const codeVerifier = base64Url(verifierBytes);
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = base64Url(hash);
  return { codeVerifier, codeChallenge };
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd = "";
  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, () => {});
}

async function findAvailablePortServer(basePort, maxAttempts) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    try {
      const server = http.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server));
      });
      return { server, port };
    } catch {
      // Port in use, try next
    }
  }
  throw new Error(`Could not find an available port in range ${basePort}-${basePort + maxAttempts - 1}`);
}

/**
 * Perform OAuth login via local HTTP server and browser.
 */
export async function loginWithChatGPT(accountName, options = {}) {
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = base64Url(crypto.randomBytes(32));
  const { server, port } = await findAvailablePortServer(BASE_PORT, MAX_PORT_ATTEMPTS);
  const redirectUri = `http://localhost:${port}/auth/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: state,
    originator: "codex_cli_rs",
  });

  const authUrl = `${DEFAULT_ISSUER}/oauth/authorize?${params.toString()}`;

  return new Promise((resolve, reject) => {
    let handled = false;

    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        server.close();
        reject(new Error("Login timed out after 3 minutes."));
      }
    }, 180000);

    server.on("request", async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      if (reqUrl.pathname !== "/auth/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const receivedState = reqUrl.searchParams.get("state");
      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");
      const errorDesc = reqUrl.searchParams.get("error_description");

      if (error) {
        handled = true;
        clearTimeout(timeout);
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Authentication Failed</h2><p>" + (errorDesc || error) + "</p>");
        server.close();
        reject(new Error(`OAuth error: ${error} (${errorDesc})`));
        return;
      }

      if (receivedState !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Invalid Request</h2><p>State mismatch or missing authorization code.</p>");
        return;
      }

      try {
        // Exchange code for tokens
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: CLIENT_ID,
          code_verifier: codeVerifier,
        });

        const tokenResp = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });

        if (!tokenResp.ok) {
          const errText = await tokenResp.text();
          throw new Error(`Token exchange failed: ${tokenResp.status} - ${errText}`);
        }

        const tokens = await tokenResp.json();
        const claims = parseChatGptIdTokenClaims(tokens.id_token);

        let finalName = accountName?.trim();
        if (!finalName) {
          if (claims.email) {
            finalName = claims.email;
          } else if (claims.account_id) {
            finalName = `ChatGPT account (${claims.account_id.slice(-8)})`;
          } else {
            finalName = "ChatGPT account";
          }
        }

        const storedAccount = {
          id: crypto.randomUUID(),
          name: finalName,
          email: claims.email,
          plan_type: claims.plan_type,
          subscription_expires_at: claims.subscription_expires_at,
          auth_mode: "chat_g_p_t",
          auth_data: {
            type: "chat_g_p_t",
            id_token: tokens.id_token,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            account_id: claims.account_id || null,
          },
          created_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        };

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Agent Switcher - Login Successful</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #0f172a; color: #f8fafc;">
              <div style="text-align: center; padding: 2.5rem; background: #1e293b; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <h1 style="color: #38bdf8; margin-bottom: 0.5rem;">Login Successful!</h1>
                <p style="color: #94a3b8; margin-bottom: 1.5rem;">Account: <strong>${finalName}</strong></p>
                <p>You can close this tab and return to your terminal.</p>
              </div>
            </body>
          </html>
        `);

        handled = true;
        clearTimeout(timeout);
        server.close();
        resolve(storedAccount);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>Login Error</h2><p>${err.message}</p>`);
        handled = true;
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });

    if (options.openBrowser !== false) {
      openBrowser(authUrl);
    }

    if (options.onAuthUrl) {
      options.onAuthUrl(authUrl);
    }
  });
}
