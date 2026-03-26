import { fetchConfig, saveConfig, browseDirectory, type HubConfig, type BrowseResult } from "./api";

function esc(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

let config: HubConfig | null = null;
let browserPath = "";
let browserResult: BrowseResult | null = null;
let saveStatus: "idle" | "saving" | "saved" = "idle";

export async function renderSettings(container: HTMLElement): Promise<void> {
  if (!config) {
    config = await fetchConfig();
  }

  container.className = "settings-area";
  container.innerHTML = `
    <div class="settings-wrap">
      <h2 class="settings-heading">Settings</h2>

      <section class="settings-section">
        <h3 class="settings-section-title">Sites</h3>
        <div id="settings-sites">${renderSitesEditor()}</div>
        <button class="settings-btn" id="settings-add-group">+ Add Group</button>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Quick Start</h3>
        <div id="settings-quickstart">${renderQuickStartEditor()}</div>
        <div class="settings-btn-row">
          <button class="settings-btn" id="settings-add-section">+ Add Section</button>
          <button class="settings-btn" id="settings-add-command">+ Add Command</button>
        </div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Discover Projects</h3>
        <div class="discover-row">
          <input type="text" id="discover-path" class="settings-input discover-input" placeholder="~/projects" value="${esc(browserPath)}" />
          <button class="settings-btn" id="discover-btn">Browse</button>
        </div>
        <div id="discover-results">${browserResult ? renderBrowserResults() : ""}</div>
      </section>

      <div class="settings-save-bar">
        <button class="settings-save-btn" id="settings-save">${saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save"}</button>
      </div>
    </div>
  `;

  attachEvents(container);
}

function renderSitesEditor(): string {
  if (!config) return "";
  const groups = Object.entries(config.sites);
  if (groups.length === 0) {
    return `<div class="settings-empty">No site groups yet. Add one below.</div>`;
  }
  return groups
    .map(
      ([group, sites]) => `
    <div class="settings-group" data-group="${esc(group)}">
      <div class="settings-group-header">
        <input type="text" class="settings-input settings-group-name" value="${esc(group)}" data-orig="${esc(group)}" />
        <button class="settings-btn-sm settings-remove-group" data-group="${esc(group)}" title="Remove group">&times;</button>
      </div>
      ${sites
        .map(
          (s, i) => `
        <div class="settings-entry" data-group="${esc(group)}" data-idx="${i}">
          <input type="text" class="settings-input settings-emoji" value="${esc(s.emoji ?? "")}" placeholder="emoji" maxlength="2" />
          <input type="text" class="settings-input settings-name" value="${esc(s.name)}" placeholder="Name" />
          <input type="url" class="settings-input settings-url" value="${esc(s.url)}" placeholder="https://..." />
          <button class="settings-btn-sm settings-remove-entry" data-group="${esc(group)}" data-idx="${i}">&times;</button>
        </div>
      `
        )
        .join("")}
      <button class="settings-btn-sm settings-add-site" data-group="${esc(group)}">+ Add Site</button>
    </div>
  `
    )
    .join("");
}

function renderQuickStartEditor(): string {
  if (!config) return "";
  if (config.quickstart.length === 0) {
    return `<div class="settings-empty">No Quick Start items. Add below.</div>`;
  }
  return config.quickstart
    .map((item, i) => {
      if (item.section) {
        return `
          <div class="settings-qs-item settings-qs-section" data-idx="${i}">
            <span class="settings-qs-type">Section</span>
            <input type="text" class="settings-input" value="${esc(item.section)}" data-field="section" />
            <button class="settings-btn-sm settings-remove-qs" data-idx="${i}">&times;</button>
          </div>`;
      }
      return `
        <div class="settings-qs-item" data-idx="${i}">
          <span class="settings-qs-type">Cmd</span>
          <input type="text" class="settings-input settings-qs-label" value="${esc(item.label ?? "")}" placeholder="Label" data-field="label" />
          <input type="text" class="settings-input settings-qs-cmd" value="${esc(item.cmd ?? "")}" placeholder="Command" data-field="cmd" />
          <button class="settings-btn-sm settings-remove-qs" data-idx="${i}">&times;</button>
        </div>`;
    })
    .join("");
}

function renderBrowserResults(): string {
  if (!browserResult) return "";
  return `
    <div class="discover-path-display">${esc(browserResult.path)}</div>
    <div class="discover-list">
      ${browserResult.entries
        .map(
          (e) => `
        <div class="discover-entry ${e.isProject ? "discover-project" : ""}" data-name="${esc(e.name)}" data-path="${esc(browserResult!.path + "/" + e.name)}">
          <span class="discover-icon">${e.isProject ? "📁" : "📂"}</span>
          <span class="discover-name">${esc(e.name)}</span>
          ${e.isProject ? `<button class="settings-btn-sm discover-add" data-path="${esc(browserResult!.path + "/" + e.name)}" data-name="${esc(e.name)}">+ Add</button>` : ""}
          <button class="settings-btn-sm discover-open" data-path="${esc(browserResult!.path + "/" + e.name)}">Open</button>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function collectConfig(): HubConfig {
  const newConfig: HubConfig = { sites: {}, quickstart: [] };

  // Collect sites
  document.querySelectorAll(".settings-group").forEach((groupEl) => {
    const nameInput = groupEl.querySelector(".settings-group-name") as HTMLInputElement;
    const groupName = nameInput.value.trim();
    if (!groupName) return;
    const sites: { name: string; url: string; emoji?: string }[] = [];
    groupEl.querySelectorAll(".settings-entry").forEach((entryEl) => {
      const emoji = (entryEl.querySelector(".settings-emoji") as HTMLInputElement).value.trim();
      const name = (entryEl.querySelector(".settings-name") as HTMLInputElement).value.trim();
      const url = (entryEl.querySelector(".settings-url") as HTMLInputElement).value.trim();
      if (name && url) {
        sites.push({ name, url, emoji: emoji || undefined });
      }
    });
    newConfig.sites[groupName] = sites;
  });

  // Collect quickstart
  document.querySelectorAll(".settings-qs-item").forEach((itemEl) => {
    const sectionInput = itemEl.querySelector('[data-field="section"]') as HTMLInputElement | null;
    if (sectionInput) {
      const section = sectionInput.value.trim();
      if (section) newConfig.quickstart.push({ section });
      return;
    }
    const label = (itemEl.querySelector('[data-field="label"]') as HTMLInputElement)?.value.trim() ?? "";
    const cmd = (itemEl.querySelector('[data-field="cmd"]') as HTMLInputElement)?.value.trim() ?? "";
    if (cmd) {
      newConfig.quickstart.push({ label: label || undefined, cmd });
    }
  });

  return newConfig;
}

function attachEvents(container: HTMLElement) {
  // Save
  container.querySelector("#settings-save")?.addEventListener("click", async () => {
    config = collectConfig();
    saveStatus = "saving";
    updateSaveBtn();
    await saveConfig(config);
    // Clear localStorage sites so server config is the source of truth
    localStorage.removeItem("claude-hub-sites");
    saveStatus = "saved";
    updateSaveBtn();
    setTimeout(() => {
      saveStatus = "idle";
      updateSaveBtn();
    }, 2000);
  });

  // Add group
  container.querySelector("#settings-add-group")?.addEventListener("click", () => {
    if (!config) return;
    const name = prompt("Group name:");
    if (!name) return;
    config.sites[name] = [];
    refreshSection(container, "settings-sites", renderSitesEditor());
  });

  // Remove group
  container.querySelectorAll(".settings-remove-group").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!config) return;
      const group = (btn as HTMLElement).dataset.group!;
      delete config.sites[group];
      refreshSection(container, "settings-sites", renderSitesEditor());
    });
  });

  // Add site to group
  container.querySelectorAll(".settings-add-site").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!config) return;
      const group = (btn as HTMLElement).dataset.group!;
      config.sites[group] = config.sites[group] ?? [];
      config.sites[group].push({ name: "", url: "" });
      refreshSection(container, "settings-sites", renderSitesEditor());
    });
  });

  // Remove site entry
  container.querySelectorAll(".settings-remove-entry").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!config) return;
      const group = (btn as HTMLElement).dataset.group!;
      const idx = Number((btn as HTMLElement).dataset.idx);
      config.sites[group]?.splice(idx, 1);
      refreshSection(container, "settings-sites", renderSitesEditor());
    });
  });

  // Add section
  container.querySelector("#settings-add-section")?.addEventListener("click", () => {
    if (!config) return;
    config.quickstart.push({ section: "New Section" });
    refreshSection(container, "settings-quickstart", renderQuickStartEditor());
  });

  // Add command
  container.querySelector("#settings-add-command")?.addEventListener("click", () => {
    if (!config) return;
    config.quickstart.push({ label: "", cmd: "" });
    refreshSection(container, "settings-quickstart", renderQuickStartEditor());
  });

  // Remove quickstart item
  container.querySelectorAll(".settings-remove-qs").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!config) return;
      const idx = Number((btn as HTMLElement).dataset.idx);
      config.quickstart.splice(idx, 1);
      refreshSection(container, "settings-quickstart", renderQuickStartEditor());
    });
  });

  // Browse
  container.querySelector("#discover-btn")?.addEventListener("click", async () => {
    const input = container.querySelector("#discover-path") as HTMLInputElement;
    browserPath = input.value.trim();
    try {
      browserResult = await browseDirectory(browserPath || undefined);
      const el = container.querySelector("#discover-results");
      if (el) {
        el.innerHTML = renderBrowserResults();
        attachBrowseEvents(container);
      }
    } catch (err) {
      const el = container.querySelector("#discover-results");
      if (el) el.innerHTML = `<div class="settings-empty">Error browsing directory</div>`;
    }
  });

  attachBrowseEvents(container);
}

function attachBrowseEvents(container: HTMLElement) {
  // Open subfolder
  container.querySelectorAll(".discover-open").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = (btn as HTMLElement).dataset.path!;
      browserPath = path;
      const input = container.querySelector("#discover-path") as HTMLInputElement;
      if (input) input.value = path;
      try {
        browserResult = await browseDirectory(path);
        const el = container.querySelector("#discover-results");
        if (el) {
          el.innerHTML = renderBrowserResults();
          attachBrowseEvents(container);
        }
      } catch {}
    });
  });

  // Add project to quickstart
  container.querySelectorAll(".discover-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!config) return;
      const path = (btn as HTMLElement).dataset.path!;
      const name = (btn as HTMLElement).dataset.name!;
      // Check if already exists
      const exists = config.quickstart.some((q) => q.cmd?.includes(path));
      if (exists) {
        (btn as HTMLElement).textContent = "Already added";
        return;
      }
      config.quickstart.push({ label: name, cmd: `cd ${path} && claude` });
      (btn as HTMLElement).textContent = "Added!";
      (btn as HTMLElement).classList.add("discover-added");
      refreshSection(container, "settings-quickstart", renderQuickStartEditor());
    });
  });
}

function refreshSection(container: HTMLElement, id: string, html: string) {
  const el = container.querySelector(`#${id}`);
  if (el) {
    el.innerHTML = html;
    attachEvents(container);
  }
}

function updateSaveBtn() {
  const btn = document.getElementById("settings-save");
  if (btn) {
    btn.textContent = saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save";
  }
}
