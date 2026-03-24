import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, userInfo } from "node:os";
import { execSync } from "node:child_process";
import type { SessionMeta, Message, ProjectGroup, ContentBlock, AgentMeta, UserInfo } from "./types.js";

const CLAUDE_DIR = join(homedir(), ".claude", "projects");
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

function decodeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function shortProjectName(projectPath: string): string {
  const parts = projectPath.split("/");
  return parts[parts.length - 1] || projectPath;
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
  }
  return "";
}

// Infer a readable agent name from the first prompt
function inferAgentName(prompt: string): string {
  if (!prompt) return "Agent";
  const p = prompt.toLowerCase();

  // Pattern: "あなたは...エージェントです" or "...Agent"
  const jaMatch = prompt.match(/あなたは.*?の(.+?(?:エージェント|Agent))/i);
  if (jaMatch) return jaMatch[1].trim();

  // Pattern: "You are a/the ... agent"
  const enMatch = prompt.match(/you are (?:a |the )?(.+?agent)/i);
  if (enMatch) return enMatch[1].trim();

  // Detect by keyword
  if (p.includes("explore")) return "Explore Agent";
  if (p.includes("search") || p.includes("scan")) return "Search Agent";
  if (p.includes("review") || p.includes("audit") || p.includes("check")) return "Review Agent";
  if (p.includes("compliance") || p.includes("ガイドライン")) return "Compliance Agent";
  if (p.includes("sns") || p.includes("instagram") || p.includes("投稿")) return "SNS Agent";
  if (p.includes("research") || p.includes("調査")) return "Research Agent";
  if (p.includes("claude code") || p.includes("claude-code")) return "Claude Code Guide";
  if (p.includes("notification") || p.includes("push")) return "Notification Agent";
  if (p.includes("spotify")) return "Spotify Agent";
  if (p.includes("security") || p.includes("sensitive")) return "Security Agent";

  // Fallback: first meaningful words
  const firstLine = prompt.split("\n")[0].slice(0, 40);
  return firstLine || "Agent";
}

// Check if a process is running
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Get active session IDs from ~/.claude/sessions/
async function getActiveSessions(): Promise<Map<string, number>> {
  const active = new Map<string, number>();
  try {
    const files = await readdir(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(SESSIONS_DIR, file), "utf-8");
        const data = JSON.parse(raw);
        if (data.pid && data.sessionId && isProcessAlive(data.pid)) {
          active.set(data.sessionId, data.pid);
        }
      } catch {}
    }
  } catch {}
  return active;
}

// Count subagents for a session
async function countAgents(dirPath: string, sessionId: string): Promise<number> {
  try {
    const subDir = join(dirPath, sessionId, "subagents");
    const files = await readdir(subDir);
    return files.filter((f) => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

// Get last exchange summary (last user msg + start of assistant reply)
function getLastSummary(lines: string[]): string {
  let lastUser = "";
  let lastAssistant = "";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user") {
        const text = extractText(obj.message?.content);
        if (text.trim()) lastUser = text.slice(0, 60);
      }
      if (obj.type === "assistant") {
        const text = extractText(obj.message?.content);
        if (text.trim()) lastAssistant = text.slice(0, 80);
      }
    } catch {}
  }

  if (lastUser && lastAssistant) {
    return `Q: ${lastUser}${lastUser.length >= 60 ? "..." : ""} → A: ${lastAssistant}${lastAssistant.length >= 80 ? "..." : ""}`;
  }
  return lastUser || lastAssistant || "";
}

export async function listSessions(): Promise<ProjectGroup[]> {
  const projectDirs = await readdir(CLAUDE_DIR);
  const groups: ProjectGroup[] = [];
  const activeSessions = await getActiveSessions();

  for (const dir of projectDirs) {
    const dirPath = join(CLAUDE_DIR, dir);
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) continue;

    const projectPath = decodeProjectDir(dir);
    const project = shortProjectName(projectPath);
    const sessions: SessionMeta[] = [];

    const files = await readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(dirPath, file);
      const sessionId = basename(file, ".jsonl");

      try {
        const fileStat = await stat(filePath);
        const raw = await readFile(filePath, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean);

        let messageCount = 0;
        let model = "";
        let firstPreview = "";
        let lastUserMsg = "";

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "user" || obj.type === "assistant") {
              messageCount++;
            }
            if (obj.type === "user") {
              const text = extractText(obj.message?.content).trim();
              if (text) {
                if (!firstPreview) firstPreview = text.slice(0, 80);
                lastUserMsg = text.slice(0, 80);
              }
            }
            if (obj.type === "assistant" && obj.message?.model) {
              model = obj.message.model;
            }
          } catch {}
        }

        // Use last user message as preview (shows current topic)
        // Fall back to first message for single-exchange sessions
        const preview = messageCount > 2 ? lastUserMsg || firstPreview : firstPreview;

        if (messageCount === 0) continue;

        const agentCount = await countAgents(dirPath, sessionId);

        sessions.push({
          id: sessionId,
          project,
          projectPath,
          messageCount,
          lastUpdated: fileStat.mtime.toISOString(),
          model: model.replace("claude-", "").split("-202")[0],
          preview,
          lastSummary: getLastSummary(lines),
          filePath,
          isActive: activeSessions.has(sessionId),
          agentCount,
        });
      } catch {
        continue;
      }
    }

    if (sessions.length === 0) continue;
    sessions.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    groups.push({ project, projectPath, sessions });
  }

  groups.sort((a, b) =>
    b.sessions[0].lastUpdated.localeCompare(a.sessions[0].lastUpdated)
  );

  return groups;
}

export async function getSessionAgents(sessionId: string): Promise<AgentMeta[]> {
  const projectDirs = await readdir(CLAUDE_DIR);
  const agents: AgentMeta[] = [];

  for (const dir of projectDirs) {
    const subDir = join(CLAUDE_DIR, dir, sessionId, "subagents");
    try {
      const files = await readdir(subDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const agentId = basename(file, ".jsonl");
        try {
          const raw = await readFile(join(subDir, file), "utf-8");
          const lines = raw.trim().split("\n").filter(Boolean);
          let msgCount = 0;
          let preview = "";

          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === "user" || obj.type === "assistant") msgCount++;
              if (obj.type === "user" && !preview) {
                preview = extractText(obj.message?.content).slice(0, 80);
              }
            } catch {}
          }

          const name = inferAgentName(preview);
          agents.push({ id: agentId, sessionId, messageCount: msgCount, preview, name });
        } catch {}
      }
    } catch {}
  }

  return agents;
}

export async function findSessionFile(sessionId: string): Promise<string | null> {
  const projectDirs = await readdir(CLAUDE_DIR);
  for (const dir of projectDirs) {
    const filePath = join(CLAUDE_DIR, dir, `${sessionId}.jsonl`);
    try {
      await stat(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  const hubPath = join(homedir(), ".claude", "hub", `${sessionId}.jsonl`);
  try {
    await stat(hubPath);
    return hubPath;
  } catch {
    return null;
  }
}

export async function getSessionMessages(sessionId: string): Promise<{
  messages: Message[];
  project: string;
  projectPath: string;
} | null> {
  const projectDirs = await readdir(CLAUDE_DIR);

  for (const dir of projectDirs) {
    const filePath = join(CLAUDE_DIR, dir, `${sessionId}.jsonl`);
    try {
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const messages: Message[] = [];

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "user" || obj.type === "assistant") {
            messages.push({
              role: obj.type as "user" | "assistant",
              content: obj.message?.content ?? "",
              model: obj.message?.model,
              timestamp: obj.timestamp,
            });
          }
        } catch {}
      }

      return {
        messages,
        project: shortProjectName(decodeProjectDir(dir)),
        projectPath: decodeProjectDir(dir),
      };
    } catch {
      continue;
    }
  }

  const hubPath = join(homedir(), ".claude", "hub", `${sessionId}.jsonl`);
  try {
    const raw = await readFile(hubPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messages: Message[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "user" || obj.type === "assistant") {
          messages.push({
            role: obj.type as "user" | "assistant",
            content: obj.message?.content ?? "",
            model: obj.message?.model,
            timestamp: obj.timestamp,
          });
        }
      } catch {}
    }

    return { messages, project: "claude-hub", projectPath: "" };
  } catch {
    return { messages: [], project: "claude-hub", projectPath: "" };
  }
}

export async function getUserInfo(): Promise<UserInfo> {
  const activeSessions = await getActiveSessions();
  const groups = await listSessions();
  const totalSessions = groups.reduce((n, g) => n + g.sessions.length, 0);

  return {
    username: userInfo().username,
    activeSessions: activeSessions.size,
    totalSessions,
    plan: "Claude Code",
  };
}

export function prepareApiMessages(
  messages: Message[],
  maxPairs = 20
): { role: "user" | "assistant"; content: string }[] {
  const textMessages: { role: "user" | "assistant"; content: string }[] = [];

  for (const msg of messages) {
    const text = extractText(msg.content);
    if (!text.trim()) continue;
    textMessages.push({ role: msg.role, content: text });
  }

  const limit = maxPairs * 2;
  if (textMessages.length > limit) {
    return textMessages.slice(-limit);
  }

  return textMessages;
}
