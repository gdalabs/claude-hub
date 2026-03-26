export interface SessionMeta {
  id: string;
  project: string;
  projectPath: string;
  messageCount: number;
  lastUpdated: string;
  model: string;
  preview: string;
  lastSummary: string;
  isActive: boolean;
  agentCount: number;
}

export interface AgentMeta {
  id: string;
  sessionId: string;
  messageCount: number;
  preview: string;
  name: string;
  taskCategory: string;
}

export interface ProjectMemoryInfo {
  project: string;
  memoryDir: string;
  fileCount: number;
  files: string[];
}

export interface ProjectGroup {
  project: string;
  projectPath: string;
  sessions: SessionMeta[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  text?: string;
  name?: string;
  input?: any;
  content?: any;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export interface ImageAttachment {
  data: string;       // base64
  media_type: string; // e.g. image/png
  preview_url: string; // object URL for preview
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  model?: string;
  timestamp?: number;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface UserInfo {
  username: string;
  activeSessions: number;
  totalSessions: number;
  plan: string;
}
