import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, userInfo } from "node:os";
import { execSync } from "node:child_process";
import type { SessionMeta, Message, ProjectGroup, ContentBlock, AgentMeta, UserInfo, ProjectMemoryInfo } from "./types.js";

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

// Categorize agent by task type from its prompt
function inferTaskCategory(prompt: string): string {
  if (!prompt) return "General";
  const p = prompt.toLowerCase();

  if (p.includes("explore") || p.includes("codebase") || p.includes("find file")) return "Explore";
  if (p.includes("plan") || p.includes("architect") || p.includes("design") || p.includes("設計")) return "Plan";
  if (p.includes("test") || p.includes("spec") || p.includes("テスト")) return "Test";
  if (p.includes("review") || p.includes("audit") || p.includes("check") || p.includes("レビュー")) return "Review";
  if (p.includes("search") || p.includes("grep") || p.includes("scan") || p.includes("検索")) return "Search";
  if (p.includes("research") || p.includes("調査") || p.includes("investigate")) return "Research";
  if (p.includes("deploy") || p.includes("build") || p.includes("デプロイ")) return "Deploy";
  if (p.includes("fix") || p.includes("bug") || p.includes("修正") || p.includes("error")) return "Fix";
  if (p.includes("refactor") || p.includes("リファクタ")) return "Refactor";
  if (p.includes("docs") || p.includes("readme") || p.includes("document") || p.includes("ドキュメント")) return "Docs";
  if (p.includes("security") || p.includes("sensitive") || p.includes("セキュリティ")) return "Security";
  if (p.includes("compliance") || p.includes("ガイドライン")) return "Compliance";
  if (p.includes("sns") || p.includes("instagram") || p.includes("投稿") || p.includes("twitter")) return "SNS";
  if (p.includes("notification") || p.includes("push") || p.includes("通知")) return "Notification";
  if (p.includes("claude code") || p.includes("claude-code")) return "Claude Code";
  if (p.includes("write") || p.includes("implement") || p.includes("create") || p.includes("add")) return "Code";

  return "General";
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

// Parse parent session JSONL to extract Agent tool_use metadata (description, subagent_type)
async function getAgentToolUseMeta(sessionId: string): Promise<Map<string, { description: string; subagentType: string }>> {
  const meta = new Map<string, { description: string; subagentType: string }>();
  const projectDirs = await readdir(CLAUDE_DIR);

  for (const dir of projectDirs) {
    const filePath = join(CLAUDE_DIR, dir, `${sessionId}.jsonl`);
    try {
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      // Collect Agent tool_use calls and match with subagent IDs
      // Agent tool_use has: name="Agent", input.description, input.subagent_type, input.prompt
      // The next subagent JSONL shares the prompt text, so we match by prompt content
      const agentCalls: { description: string; subagentType: string; promptStart: string }[] = [];

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type !== "assistant") continue;
          const content = obj.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (block.type === "tool_use" && block.name === "Agent" && block.input) {
              agentCalls.push({
                description: block.input.description || "",
                subagentType: block.input.subagent_type || block.input.subagentType || "general-purpose",
                promptStart: (block.input.prompt || "").slice(0, 120),
              });
            }
          }
        } catch {}
      }

      // Now read subagent files to match by first prompt
      const subDir = join(CLAUDE_DIR, dir, sessionId, "subagents");
      try {
        const subFiles = await readdir(subDir);
        for (const file of subFiles) {
          if (!file.endsWith(".jsonl")) continue;
          const agentId = basename(file, ".jsonl");
          try {
            const subRaw = await readFile(join(subDir, file), "utf-8");
            const firstLine = subRaw.split("\n")[0];
            const firstObj = JSON.parse(firstLine);
            const firstPrompt = extractText(firstObj.message?.content).slice(0, 120);

            // Match with parent's Agent tool_use by comparing prompt start
            const match = agentCalls.find((c) => c.promptStart && firstPrompt.startsWith(c.promptStart.slice(0, 60)));
            if (match) {
              meta.set(agentId, { description: match.description, subagentType: match.subagentType });
            }
          } catch {}
        }
      } catch {}
    } catch {}
  }

  return meta;
}

export async function getSessionAgents(sessionId: string): Promise<AgentMeta[]> {
  const projectDirs = await readdir(CLAUDE_DIR);
  const agents: AgentMeta[] = [];

  // Get metadata from parent session's Agent tool_use calls
  const toolUseMeta = await getAgentToolUseMeta(sessionId);

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

          // Use real metadata from Agent tool_use if available
          const meta = toolUseMeta.get(agentId);
          let name: string;
          let taskCategory: string;

          if (meta) {
            // Real data: use description as name, subagent_type as category
            name = meta.description || inferAgentName(preview);
            taskCategory = meta.subagentType === "general-purpose" ? inferTaskCategory(preview)
              : meta.subagentType.charAt(0).toUpperCase() + meta.subagentType.slice(1);
          } else {
            // Fallback to inference
            name = inferAgentName(preview);
            taskCategory = inferTaskCategory(preview);
          }

          agents.push({ id: agentId, sessionId, messageCount: msgCount, preview, name, taskCategory });
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

export async function getProjectMemory(projectDirName: string): Promise<ProjectMemoryInfo> {
  const memoryDir = join(homedir(), ".claude", "projects", projectDirName, "memory");
  try {
    const files = await readdir(memoryDir);
    const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    return {
      project: shortProjectName(decodeProjectDir(projectDirName)),
      memoryDir,
      fileCount: mdFiles.length,
      files: mdFiles,
    };
  } catch {
    return {
      project: shortProjectName(decodeProjectDir(projectDirName)),
      memoryDir,
      fileCount: 0,
      files: [],
    };
  }
}

export async function getAllProjectMemories(): Promise<ProjectMemoryInfo[]> {
  try {
    const projectDirs = await readdir(CLAUDE_DIR);
    const results: ProjectMemoryInfo[] = [];
    for (const dir of projectDirs) {
      const dirPath = join(CLAUDE_DIR, dir);
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) continue;
      results.push(await getProjectMemory(dir));
    }
    return results;
  } catch {
    return [];
  }
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
