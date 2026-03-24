import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const CONFIG_PATH = join(process.cwd(), "hub.config.json");

export interface SiteEntry {
  name: string;
  url: string;
  emoji?: string;
}

export interface QuickStartItem {
  section?: string;
  label?: string;
  cmd?: string;
  display?: string;
}

export interface HubConfig {
  sites: Record<string, SiteEntry[]>;
  quickstart: QuickStartItem[];
}

const DEFAULT_CONFIG: HubConfig = {
  sites: {},
  quickstart: [
    { section: "Claude Code Commands" },
    { cmd: "/init", display: "/init — Create CLAUDE.md" },
    { cmd: "/cost", display: "/cost — Check token usage" },
    { cmd: "/context", display: "/context — Show context" },
    { cmd: "/exit", display: "/exit — Exit session" },
    { cmd: "/help", display: "/help — Show help" },
  ],
};

export async function loadConfig(): Promise<HubConfig> {
  try {
    await access(CONFIG_PATH);
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // First run — write default config
    await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: HubConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
