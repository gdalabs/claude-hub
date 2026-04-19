import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { listSessions, getSessionMessages, getSessionAgents, getUserInfo, getAllProjectMemories } from "./sessions.js";
import { streamChat, getModels, createSession } from "./chat.js";
import { loadConfig, saveConfig } from "./config.js";
import type { HubConfig } from "./config.js";
import { browseDirectory } from "./browse.js";
import { authMiddleware, rateLimitMiddleware, auditMiddleware, handleLogin } from "./security.js";

const app = new Hono();

// Security layers
app.use("/api/*", rateLimitMiddleware());
app.use("/api/*", auditMiddleware());
app.use("/api/*", authMiddleware());

// Login page (no auth required)
app.get("/auth/login", (c) => handleLogin(c));

// Config
app.get("/api/config", async (c) => {
  const config = await loadConfig();
  return c.json(config);
});

app.put("/api/config", async (c) => {
  const body = await c.req.json<HubConfig>();

  // Validate structure
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid config" }, 400);
  }
  if (typeof body.sites !== "object" || Array.isArray(body.sites)) {
    return c.json({ error: "Invalid sites: must be an object" }, 400);
  }
  if (!Array.isArray(body.quickstart)) {
    return c.json({ error: "Invalid quickstart: must be an array" }, 400);
  }
  // Validate site entries
  for (const [group, sites] of Object.entries(body.sites)) {
    if (!Array.isArray(sites)) {
      return c.json({ error: `Invalid sites group: ${group}` }, 400);
    }
    for (const s of sites) {
      if (typeof s.name !== "string" || typeof s.url !== "string") {
        return c.json({ error: `Invalid site entry in ${group}` }, 400);
      }
    }
  }
  // Strip to known fields only
  const clean: HubConfig = {
    sites: body.sites,
    quickstart: body.quickstart,
  };

  await saveConfig(clean);
  return c.json({ ok: true });
});

// Browse local directories
app.get("/api/browse", async (c) => {
  const path = c.req.query("path");
  try {
    const result = await browseDirectory(path || undefined);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Session list
app.get("/api/sessions", async (c) => {
  const groups = await listSessions();
  return c.json(groups);
});

// Session detail (messages)
app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionMessages(id);
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

// Session agents
app.get("/api/sessions/:id/agents", async (c) => {
  const id = c.req.param("id");
  const agents = await getSessionAgents(id);
  return c.json(agents);
});

// Project memory files
app.get("/api/memories", async (c) => {
  const memories = await getAllProjectMemories();
  return c.json(memories);
});

// Create new session
app.post("/api/sessions", async (c) => {
  const id = await createSession();
  return c.json({ id });
});

// Available models
app.get("/api/models", (c) => {
  return c.json(getModels());
});

// User info
app.get("/api/user", async (c) => {
  const info = await getUserInfo();
  return c.json(info);
});

// Chat (SSE streaming)
app.post("/api/chat/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const { message, model, images } = await c.req.json<{
    message: string;
    model: string;
    images?: { data: string; media_type: string }[];
  }>();

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of streamChat(sessionId, message, model, images)) {
        await stream.writeSSE({ data: chunk });
      }
      await stream.writeSSE({ data: "[DONE]" });
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: err.message || "Unknown error",
      });
    }
  });
});

const PORT = Number(process.env.PORT) || 3456;
// Default to localhost for security; set HOST=0.0.0.0 to allow network access
const HOST = process.env.HOST || "127.0.0.1";

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`claude-hub running on http://${HOST}:${info.port}`);
  console.log(`  Local:     http://localhost:${info.port}`);
  console.log(`  Network:   http://<your-ip>:${info.port}`);
});
