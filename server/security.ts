import { Context, Next } from "hono";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_FILE = join(homedir(), ".claude", "hub-access.log");

// ── Bearer Token Auth ──
// Set via HUB_SECRET env var or .env file
export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const secret = process.env.HUB_SECRET;
    // If no secret configured, skip auth (backwards compatible for local-only use)
    if (!secret) return next();

    const auth = c.req.header("Authorization");
    if (auth === `Bearer ${secret}`) return next();

    // Also check cookie (for browser UI)
    const cookie = c.req.header("Cookie") || "";
    const match = cookie.match(/hub_token=([^;]+)/);
    if (match && match[1] === secret) return next();

    await logAccess(c, "AUTH_FAILED");
    return c.json({ error: "Unauthorized" }, 401);
  };
}

// ── Login endpoint (sets cookie for browser) ──
export function handleLogin(c: Context): Response {
  const secret = process.env.HUB_SECRET;
  if (!secret) {
    // No auth configured, just redirect
    return c.redirect("/");
  }

  const token = c.req.query("token");
  if (token === secret) {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/",
        "Set-Cookie": `hub_token=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
      },
    });
  }

  return c.html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>claude-hub login</title>
<style>
body { font-family: system-ui; background: #111; color: #eee; display: flex; justify-content: center; align-items: center; height: 100vh; }
form { background: #1a1a1a; padding: 32px; border-radius: 12px; max-width: 360px; width: 100%; }
h2 { margin-bottom: 16px; }
input { width: 100%; padding: 10px; border: 1px solid #333; border-radius: 8px; background: #222; color: #eee; font-size: 14px; margin-bottom: 12px; }
button { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #fff; color: #000; font-weight: 600; cursor: pointer; }
</style></head><body>
<form method="GET" action="/auth/login">
<h2>claude-hub</h2>
<input type="password" name="token" placeholder="Access Token" autofocus>
<button type="submit">Login</button>
</form></body></html>`);
}

// ── Rate Limiting (in-memory, per IP) ──
const rateLimitMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 60; // requests per window
const RATE_WINDOW = 60_000; // 1 minute

export function rateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown";
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + RATE_WINDOW };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;
    if (entry.count > RATE_LIMIT) {
      await logAccess(c, "RATE_LIMITED");
      return c.json({ error: "Too many requests" }, 429);
    }

    // Cleanup old entries periodically
    if (rateLimitMap.size > 100) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.reset) rateLimitMap.delete(k);
      }
    }

    return next();
  };
}

// ── Audit Logging ──
export async function logAccess(c: Context, event: string = "ACCESS") {
  const now = new Date().toISOString();
  const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "local";
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const line = `${now} | ${event} | ${ip} | ${method} ${path}\n`;

  try {
    await appendFile(LOG_FILE, line);
  } catch {
    // Fail silently — don't break the app for logging
  }
}

export function auditMiddleware() {
  return async (c: Context, next: Next) => {
    await logAccess(c);
    return next();
  };
}
