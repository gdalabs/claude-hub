import { readdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface BrowseEntry {
  name: string;
  isProject: boolean;
}

export interface BrowseResult {
  path: string;
  entries: BrowseEntry[];
}

// Restrict browsing to user's home directory
const HOME = homedir();

export async function browseDirectory(requestedPath?: string): Promise<BrowseResult> {
  const base = resolve(requestedPath || HOME);

  // Security: only allow browsing within home directory
  if (!base.startsWith(HOME)) {
    throw new Error("Access denied: can only browse within home directory");
  }

  // Block sensitive directories
  const BLOCKED = [".ssh", ".gnupg", ".aws", ".config/gcloud", ".env", ".claude/sessions"];
  const relPath = base.slice(HOME.length + 1);
  if (BLOCKED.some((b) => relPath === b || relPath.startsWith(b + "/"))) {
    throw new Error("Access denied: restricted directory");
  }

  const dirents = await readdir(base, { withFileTypes: true });
  const dirs = dirents.filter((d) => d.isDirectory() && !d.name.startsWith("."));

  const entries: BrowseEntry[] = await Promise.all(
    dirs.map(async (d) => {
      const full = join(base, d.name);
      const markers = ["CLAUDE.md", "package.json", ".git"];
      const isProject = (
        await Promise.all(
          markers.map((m) =>
            access(join(full, m))
              .then(() => true)
              .catch(() => false)
          )
        )
      ).some(Boolean);
      return { name: d.name, isProject };
    })
  );

  return { path: base, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
}
