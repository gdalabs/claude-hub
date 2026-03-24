import Anthropic from "@anthropic-ai/sdk";
import { appendFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSessionMessages, prepareApiMessages, findSessionFile } from "./sessions.js";
import { randomUUID } from "node:crypto";

const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export function getModels() {
  return MODELS.map((m) => ({ id: m.id, label: m.label }));
}

export async function createSession(): Promise<string> {
  const id = randomUUID();
  const hubDir = join(homedir(), ".claude", "hub");
  await mkdir(hubDir, { recursive: true });
  return id;
}

async function appendToLog(sessionId: string, entry: any) {
  // Try existing session file first, then hub directory for new sessions
  const existingPath = await findSessionFile(sessionId);
  if (existingPath) {
    await appendFile(existingPath, JSON.stringify(entry) + "\n");
    return;
  }

  const hubDir = join(homedir(), ".claude", "hub");
  await mkdir(hubDir, { recursive: true });
  const hubPath = join(hubDir, `${sessionId}.jsonl`);
  await appendFile(hubPath, JSON.stringify(entry) + "\n");
}

export async function* streamChat(
  sessionId: string,
  userMessage: string,
  modelId: string,
  images?: { data: string; media_type: string }[]
): AsyncGenerator<string> {
  const anthropic = getClient();

  // Load existing messages
  let existingMessages: { role: "user" | "assistant"; content: any }[] = [];

  const session = await getSessionMessages(sessionId);
  if (session) {
    existingMessages = prepareApiMessages(session.messages);
  }

  // Build user content (text + optional images)
  if (images && images.length > 0) {
    const content: any[] = images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type,
        data: img.data,
      },
    }));
    if (userMessage) {
      content.push({ type: "text", text: userMessage });
    }
    existingMessages.push({ role: "user", content });
  } else {
    existingMessages.push({ role: "user", content: userMessage });
  }

  // Ensure messages alternate correctly (start with user)
  const cleaned: typeof existingMessages = [];
  for (const msg of existingMessages) {
    if (cleaned.length === 0 && msg.role !== "user") continue;
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === msg.role) continue;
    cleaned.push(msg);
  }

  // Log user message
  const now = Date.now();
  await appendToLog(sessionId, {
    type: "user",
    message: { role: "user", content: userMessage },
    uuid: randomUUID(),
    timestamp: now,
  });

  // Stream response
  let fullResponse = "";

  const stream = anthropic.messages.stream({
    model: modelId,
    max_tokens: 8192,
    messages: cleaned,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullResponse += event.delta.text;
      yield event.delta.text;
    }
  }

  // Log assistant response
  await appendToLog(sessionId, {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: fullResponse }],
      model: modelId,
    },
    uuid: randomUUID(),
    timestamp: Date.now(),
  });
}
