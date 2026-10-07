/**
 * Safely parse ChatGPT ID token claims from JWT without external dependencies.
 */
export function parseChatGptIdTokenClaims(idToken) {
  if (!idToken || typeof idToken !== "string") {
    return {
      email: null,
      plan_type: null,
      account_id: null,
      subscription_expires_at: null,
    };
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return {
      email: null,
      plan_type: null,
      account_id: null,
      subscription_expires_at: null,
    };
  }

  try {
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    const json = JSON.parse(jsonStr);

    const authClaims = json["https://api.openai.com/auth"] || {};

    const email = typeof json.email === "string" && json.email.trim() ? json.email.trim() : null;
    const planType =
      typeof authClaims.chatgpt_plan_type === "string" && authClaims.chatgpt_plan_type.trim()
        ? authClaims.chatgpt_plan_type.trim()
        : null;
    const accountId =
      typeof authClaims.chatgpt_account_id === "string" && authClaims.chatgpt_account_id.trim()
        ? authClaims.chatgpt_account_id.trim()
        : null;

    let subscriptionExpiresAt = null;
    if (authClaims.chatgpt_subscription_active_until) {
      const parsed = new Date(authClaims.chatgpt_subscription_active_until);
      if (!Number.isNaN(parsed.getTime())) {
        subscriptionExpiresAt = parsed.toISOString();
      }
    }

    return {
      email,
      plan_type: planType,
      account_id: accountId,
      subscription_expires_at: subscriptionExpiresAt,
    };
  } catch {
    return {
      email: null,
      plan_type: null,
      account_id: null,
      subscription_expires_at: null,
    };
  }
}
