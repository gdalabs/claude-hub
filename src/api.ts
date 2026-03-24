import type { ProjectGroup, Message, ModelOption, AgentMeta, UserInfo } from "./types";

export interface QuickStartItem {
  section?: string;
  label?: string;
  cmd?: string;
  display?: string;
}

export interface HubConfig {
  sites: Record<string, { name: string; url: string; emoji?: string }[]>;
  quickstart: QuickStartItem[];
}

export async function fetchConfig(): Promise<HubConfig> {
  const res = await fetch("/api/config");
  return res.json();
}

export async function fetchSessions(): Promise<ProjectGroup[]> {
  const res = await fetch("/api/sessions");
  return res.json();
}

export async function fetchSession(
  id: string
): Promise<{ messages: Message[]; project: string; projectPath: string }> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export async function createSession(): Promise<string> {
  const res = await fetch("/api/sessions", { method: "POST" });
  const data = await res.json();
  return data.id;
}

export async function fetchModels(): Promise<ModelOption[]> {
  const res = await fetch("/api/models");
  return res.json();
}

export async function fetchAgents(sessionId: string): Promise<AgentMeta[]> {
  const res = await fetch(`/api/sessions/${sessionId}/agents`);
  return res.json();
}

export async function fetchUserInfo(): Promise<UserInfo> {
  const res = await fetch("/api/user");
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string,
  model: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  images?: { data: string; media_type: string }[]
): Promise<void> {
  const res = await fetch(`/api/chat/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, model, images }),
  });

  if (!res.ok || !res.body) {
    onError("Failed to send message");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          onDone();
          return;
        }
        onChunk(data);
      }
      if (line.startsWith("event: error")) {
        // next data line is the error
      }
    }
  }

  onDone();
}
