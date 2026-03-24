export interface SessionMeta {
  id: string;
  project: string;
  projectPath: string;
  messageCount: number;
  lastUpdated: string;
  model: string;
  preview: string;
  lastSummary: string; // last user+assistant exchange summary
  filePath: string;
  isActive: boolean;
  agentCount: number;
}

export interface AgentMeta {
  id: string;
  sessionId: string;
  messageCount: number;
  preview: string;
  name: string; // inferred agent name/role
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  model?: string;
  timestamp?: number;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: any;
  content?: any;
  id?: string;
  tool_use_id?: string;
}

export interface ProjectGroup {
  project: string;
  projectPath: string;
  sessions: SessionMeta[];
}

export interface UserInfo {
  username: string;
  activeSessions: number;
  totalSessions: number;
  plan: string;
}
