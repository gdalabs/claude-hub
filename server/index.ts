import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { listSessions, getSessionMessages, getSessionAgents, getUserInfo } from "./sessions.js";
import { streamChat, getModels, createSession } from "./chat.js";
import { loadConfig, saveConfig } from "./config.js";
import type { HubConfig } from "./config.js";

const app = new Hono();

// Config
app.get("/api/config", async (c) => {
  const config = await loadConfig();
  return c.json(config);
});

app.put("/api/config", async (c) => {
  const body = await c.req.json<HubConfig>();
  await saveConfig(body);
  return c.json({ ok: true });
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
const HOST = process.env.HOST || "0.0.0.0";

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`claude-hub running on http://${HOST}:${info.port}`);
  console.log(`  Local:     http://localhost:${info.port}`);
  console.log(`  Network:   http://<your-ip>:${info.port}`);
});
