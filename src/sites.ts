// Deployed sites per project — loaded from hub.config.json via API, cached in localStorage

export interface SiteEntry {
  name: string;
  url: string;
  emoji?: string;
}

const STORAGE_KEY = "claude-hub-sites";

let configSites: Record<string, SiteEntry[]> | null = null;

export async function initSites(): Promise<void> {
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    configSites = config.sites ?? {};
  } catch {
    configSites = {};
  }
}

function load(): Record<string, SiteEntry[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return structuredClone(configSites ?? {});
}

function save(data: Record<string, SiteEntry[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getSites(project: string): SiteEntry[] {
  const all = load();
  return all[project] ?? [];
}

export function addSite(project: string, entry: SiteEntry) {
  const all = load();
  if (!all[project]) all[project] = [];
  all[project].push(entry);
  save(all);
}

export function removeSite(project: string, index: number) {
  const all = load();
  if (!all[project]) return;
  all[project].splice(index, 1);
  save(all);
}
