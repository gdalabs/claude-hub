import "./style.css";
import { fetchSessions, fetchModels, fetchUserInfo, fetchAgents, fetchMemories, createSession, fetchConfig } from "./api";
import type { QuickStartItem } from "./api";
import { renderChatView } from "./chat-view";
import { generateQRSvg } from "./qrcode";
import { getSites, addSite, removeSite, initSites } from "./sites";
import { renderSettings } from "./settings";
import type { ProjectGroup, ModelOption, UserInfo, SessionMeta, AgentMeta, ProjectMemoryInfo } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentModel = localStorage.getItem("claude-hub-model") || "claude-opus-4-6";
let currentTheme = localStorage.getItem("claude-hub-theme") || "dark";

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
  currentTheme = theme;
  localStorage.setItem("claude-hub-theme", theme);
}

// Apply saved theme immediately
applyTheme(currentTheme);
let models: ModelOption[] = [];
let user: UserInfo | null = null;
let groups: ProjectGroup[] = [];
let activeProjectIdx = 0;
let selectedSessionId: string | null = null;
let quickstartItems: QuickStartItem[] = [];

function esc(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function statusDot(isActive: boolean): string {
  return isActive
    ? '<span class="pulse pulse-green"></span>'
    : '<span class="pulse pulse-gray"></span>';
}

function statusPill(isActive: boolean): string {
  return isActive
    ? '<span class="status-pill pill-running">running</span>'
    : '<span class="status-pill pill-idle">idle</span>';
}

function sparkline(msgCount: number, isActive: boolean): string {
  const bars = [3, 5, 4, 6, 7, 5, 8, (msgCount % 9) + 2].map((h, i) => {
    const lit = isActive && i > 4;
    const height = Math.max(3, h * 2);
    return `<div class="spark-bar${lit ? " lit" : ""}" style="height:${height}px"></div>`;
  });
  return `<div class="mini-sparkline">${bars.join("")}</div>`;
}

async function init() {
  const [modelsResult, userResult, groupsResult, config] = await Promise.all([
    fetchModels().catch(() => [
      { id: "claude-opus-4-6", label: "Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ]),
    fetchUserInfo().catch(() => null),
    fetchSessions().catch(() => []),
    fetchConfig().catch(() => ({ sites: {}, quickstart: [] })),
  ]);
  models = modelsResult;
  user = userResult;
  groups = groupsResult;
  quickstartItems = config.quickstart ?? [];
  await initSites();

  applyProjectOrder();
  renderShell();
  renderSidebar();
  renderMain();
}

function renderSitesBar(project: string): string {
  const sites = getSites(project);
  return `
    <div class="sites-bar" id="sites-bar">
      <span class="sites-label">Sites</span>
      ${sites.map((s, i) => `<span class="site-chip-wrap" data-idx="${i}"><a class="site-chip" href="${esc(s.url)}" target="_blank" rel="noopener">${s.emoji ? s.emoji + " " : ""}${esc(s.name)}</a><button class="site-remove" data-idx="${i}" title="Remove">&times;</button></span>`).join("")}
      <button class="site-add-btn" id="site-add-btn" title="Add site">+</button>
    </div>
    <div class="site-add-form hidden" id="site-add-form">
      <input type="text" id="site-emoji" placeholder="🌐" class="site-input site-input-emoji" maxlength="2" />
      <input type="text" id="site-name" placeholder="Name" class="site-input site-input-name" />
      <input type="url" id="site-url" placeholder="https://..." class="site-input site-input-url" />
      <button class="site-save-btn" id="site-save-btn">Add</button>
      <button class="site-cancel-btn" id="site-cancel-btn">Cancel</button>
    </div>
  `;
}

function renderQuickStart(): string {
  if (quickstartItems.length === 0) {
    return `<div class="recovery-section-label">Edit hub.config.json to add your commands here</div>`;
  }

  return quickstartItems.map((item) => {
    if (item.section) {
      return `<div class="recovery-section-label">${esc(item.section)}</div>`;
    }
    const display = item.display ?? item.cmd ?? "";
    const labelHtml = item.label ? `<div class="recovery-label">${esc(item.label)}</div>` : "";
    return `<div class="recovery-group">${labelHtml}<code class="recovery-code" data-copy="${esc(item.cmd ?? "")}">${esc(display)}</code></div>`;
  }).join("");
}

function renderShell() {
  const p = groups[activeProjectIdx];
  const activeCount = p?.sessions.filter((s) => s.isActive).length ?? 0;
  const totalAgents = p?.sessions.reduce((n, s) => n + s.agentCount, 0) ?? 0;

  app.innerHTML = `
    <div class="layout">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="logo-row">
            <div class="logo-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L7 2L12 7L7 12L2 7Z" fill="white"/></svg></div>
            <span class="logo-text">claude-hub</span>
          </div>
          <input type="text" class="search-box" placeholder="Search projects..." id="search-input" />
        </div>
        <div class="section-label">Projects</div>
        <div id="sidebar-content"></div>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="user-avatar">${(user?.username ?? "U")[0].toUpperCase()}</div>
            <div class="user-info">
              <div class="user-name">${esc(user?.username ?? "user")}</div>
              <div class="user-plan">${esc(user?.plan ?? "Claude Code")}</div>
            </div>
          </div>
          <button class="new-btn" id="btn-new-chat">+ New Chat</button>
        </div>
      </aside>

      <div class="main">
        <details class="quickstart-bar" id="quickstart-bar">
          <summary class="quickstart-toggle">Quick Start</summary>
          <div class="quickstart-body">${renderQuickStart()}</div>
        </details>
        <div class="qr-banner" id="qr-banner">
          <button class="qr-toggle-btn" id="qr-toggle" title="Show QR code for mobile access">QR</button>
          <div class="qr-popup hidden" id="qr-popup">
            <div class="qr-content" id="qr-content"></div>
            <div class="qr-url" id="qr-url"></div>
          </div>
        </div>
        <div class="main-header">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="menu-toggle" id="menu-toggle">&#9776;</button>
            <div>
            <div class="main-title">
              <span id="proj-title">${esc(p?.project ?? "")}</span>
              ${statusPill(activeCount > 0)}
            </div>
            <div class="main-subtitle">${p?.sessions.length ?? 0} sessions · updated ${fmtDate(p?.sessions[0]?.lastUpdated ?? "")}</div>
          </div>
          </div>
          <div class="header-stats">
            <div class="stat-item">
              <div class="stat-num">${activeCount}</div>
              <div class="stat-label">Active</div>
            </div>
            <div class="stat-item">
              <div class="stat-num">${p?.sessions.length ?? 0}</div>
              <div class="stat-label">Sessions</div>
            </div>
            <div class="stat-item stat-clickable" id="stat-agents" title="View all agents">
              <div class="stat-num">${totalAgents}</div>
              <div class="stat-label">Agents</div>
            </div>
            <div class="stat-item">
              <select id="model-select" class="model-select">
                ${models.map((m) => `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${m.label}</option>`).join("")}
              </select>
              <div class="stat-label">Model</div>
            </div>
            <button class="theme-toggle" id="theme-toggle" title="Toggle theme">
              ${currentTheme === "dark" ? "&#9788;" : "&#9790;"}
            </button>
          </div>
        </div>

        <div class="tab-bar">
          <div class="tab active" data-tab="agents">Sessions</div>
          <div class="tab" data-tab="chat">Chat</div>
          <div class="tab" data-tab="settings">Settings</div>
        </div>

        ${renderSitesBar(p?.project ?? "")}

        <div id="main-content" class="agent-grid-area">
          <div class="agent-grid" id="agent-grid"></div>
        </div>
      </div>

      <div class="detail-panel hidden" id="detail-panel">
        <div class="detail-header">
          <div>
            <div class="detail-name" id="detail-name"></div>
            <div class="detail-id" id="detail-id"></div>
          </div>
          <button class="detail-close" id="close-detail">&times;</button>
        </div>
        <div class="detail-body" id="detail-body"></div>
      </div>
    </div>
  `;

  // Events
  document.getElementById("model-select")?.addEventListener("change", (e) => {
    currentModel = (e.target as HTMLSelectElement).value;
    localStorage.setItem("claude-hub-model", currentModel);
  });

  function fallbackCopy(text: string, onSuccess: () => void) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    onSuccess();
  }

  // Recovery commands: click to copy (event delegation)
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest(".recovery-code");
    if (!el) return;
    e.stopPropagation();
    const cmd = (el as HTMLElement).dataset.copy ?? el.textContent ?? "";
    const showCopied = () => {
      const orig = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => { el.textContent = orig; }, 1000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cmd).then(showCopied).catch(() => fallbackCopy(cmd, showCopied));
    } else {
      fallbackCopy(cmd, showCopied);
    }
  });

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    applyTheme(next);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.innerHTML = next === "dark" ? "&#9788;" : "&#9790;";
  });

  document.getElementById("btn-new-chat")?.addEventListener("click", () => {
    closeSidebar();
    startNewChat();
  });

  // Mobile sidebar toggle
  document.getElementById("menu-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-overlay")?.addEventListener("click", closeSidebar);
  // QR code toggle
  const qrToggle = document.getElementById("qr-toggle");
  const qrPopup = document.getElementById("qr-popup");
  qrToggle?.addEventListener("click", () => {
    const isHidden = qrPopup?.classList.toggle("hidden") === false;
    if (isHidden) {
      const url = window.location.href;
      const qrContent = document.getElementById("qr-content");
      const qrUrl = document.getElementById("qr-url");
      if (qrContent) qrContent.innerHTML = generateQRSvg(url, 3, 2);
      if (qrUrl) qrUrl.textContent = url;
    }
  });

  // Sites bar: add / remove
  document.getElementById("site-add-btn")?.addEventListener("click", () => {
    document.getElementById("site-add-form")?.classList.remove("hidden");
    (document.getElementById("site-name") as HTMLInputElement)?.focus();
  });
  document.getElementById("site-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("site-add-form")?.classList.add("hidden");
  });
  document.getElementById("site-save-btn")?.addEventListener("click", () => {
    const p = groups[activeProjectIdx];
    if (!p) return;
    const emoji = (document.getElementById("site-emoji") as HTMLInputElement).value.trim();
    const name = (document.getElementById("site-name") as HTMLInputElement).value.trim();
    const url = (document.getElementById("site-url") as HTMLInputElement).value.trim();
    if (!name || !url) return;
    addSite(p.project, { name, url, emoji: emoji || undefined });
    renderShell();
    renderSidebar();
    renderMain();
  });
  document.querySelectorAll(".site-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number((btn as HTMLElement).dataset.idx);
      const p = groups[activeProjectIdx];
      if (!p) return;
      removeSite(p.project, idx);
      renderShell();
      renderSidebar();
      renderMain();
    });
  });

  document.getElementById("stat-agents")?.addEventListener("click", showAgentsOverview);
  document.getElementById("close-detail")?.addEventListener("click", () => {
    selectedSessionId = null;
    document.getElementById("detail-panel")?.classList.add("hidden");
    renderAgentGrid();
  });

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const tabName = (tab as HTMLElement).dataset.tab;
      if (tabName === "agents") {
        renderAgentGrid();
      } else if (tabName === "chat" && selectedSessionId) {
        showChat(selectedSessionId);
      } else if (tabName === "settings") {
        const content = document.getElementById("main-content")!;
        renderSettings(content);
      }
    });
  });

  // Search
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    document.querySelectorAll(".project-item").forEach((item) => {
      const name = (item as HTMLElement).dataset.name ?? "";
      (item as HTMLElement).style.display = name.includes(q) ? "" : "none";
    });
  });
}

function saveProjectOrder() {
  const order = groups.map((g) => g.project);
  localStorage.setItem("claude-hub-project-order", JSON.stringify(order));
}

function applyProjectOrder() {
  const saved = localStorage.getItem("claude-hub-project-order");
  if (!saved) return;
  try {
    const order: string[] = JSON.parse(saved);
    const sorted: ProjectGroup[] = [];
    for (const name of order) {
      const found = groups.find((g) => g.project === name);
      if (found) sorted.push(found);
    }
    // Append any new projects not in saved order
    for (const g of groups) {
      if (!sorted.includes(g)) sorted.push(g);
    }
    groups.length = 0;
    groups.push(...sorted);
  } catch {}
}

let dragSrcIdx: number | null = null;

function renderSidebar() {
  const container = document.getElementById("sidebar-content")!;
  container.innerHTML = groups
    .map(
      (g, i) => `
    <div class="project-item ${i === activeProjectIdx ? "active" : ""}" data-idx="${i}" data-name="${esc(g.project.toLowerCase())}" draggable="true">
      <div class="proj-drag-handle">&#8942;</div>
      <div class="proj-dot" style="background:${getProjectColor(i)}"></div>
      <div class="proj-info">
        <div class="proj-name">${esc(g.project)}</div>
        <div class="proj-meta">${g.sessions.filter((s) => s.isActive).length}/${g.sessions.length} active</div>
      </div>
      <div class="proj-count">${g.sessions.length}</div>
    </div>
  `
    )
    .join("");

  container.querySelectorAll(".project-item").forEach((item) => {
    const el = item as HTMLElement;

    // Click to select
    el.addEventListener("click", () => {
      activeProjectIdx = Number(el.dataset.idx);
      selectedSessionId = null;
      closeSidebar();
      document.getElementById("detail-panel")?.classList.add("hidden");
      renderShell();
      renderSidebar();
      renderMain();
    });

    // Drag start
    el.addEventListener("dragstart", (e) => {
      dragSrcIdx = Number(el.dataset.idx);
      el.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", String(dragSrcIdx));
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      container.querySelectorAll(".project-item").forEach((it) => {
        (it as HTMLElement).classList.remove("drag-above", "drag-below");
      });
      dragSrcIdx = null;
    });

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      const targetIdx = Number(el.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      // Clear all indicators
      container.querySelectorAll(".project-item").forEach((it) => {
        (it as HTMLElement).classList.remove("drag-above", "drag-below");
      });
      if (e.clientY < mid) {
        el.classList.add("drag-above");
      } else {
        el.classList.add("drag-below");
      }
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-above", "drag-below");
    });

    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetIdx = Number(el.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;

      // Reorder groups
      const activeProject = groups[activeProjectIdx]?.project;
      const [moved] = groups.splice(dragSrcIdx, 1);
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let insertIdx = e.clientY < mid ? targetIdx : targetIdx + 1;
      if (dragSrcIdx < targetIdx) insertIdx--;
      groups.splice(Math.max(0, insertIdx), 0, moved);

      // Preserve active selection
      activeProjectIdx = groups.findIndex((g) => g.project === activeProject);
      if (activeProjectIdx < 0) activeProjectIdx = 0;

      saveProjectOrder();
      renderSidebar();
    });
  });
}

function renderMain() {
  renderAgentGrid();
}

function renderAgentGrid() {
  const p = groups[activeProjectIdx];
  if (!p) return;

  const content = document.getElementById("main-content")!;
  content.className = "agent-grid-area";
  content.innerHTML = `<div class="agent-grid" id="agent-grid">
    ${p.sessions
      .map(
        (s) => `
      <div class="agent-card ${selectedSessionId === s.id ? "selected" : ""}" data-id="${s.id}">
        <div class="agent-top">
          <div class="agent-icon-name">
            <div class="agent-icon">${s.isActive ? "🟢" : "💤"}</div>
            <div style="min-width:0">
              <div class="agent-name" title="${esc(s.preview)}">${esc(s.preview.slice(0, 50) || "Session")}${s.preview.length > 50 ? "…" : ""}</div>
              <div class="agent-type">${esc(s.model)} · ${s.agentCount > 0 ? s.agentCount + " sub-agents" : "no agents"}</div>
            </div>
          </div>
          <div class="agent-status">
            ${statusDot(s.isActive)}
            ${statusPill(s.isActive)}
          </div>
        </div>
        <div class="agent-activity">
          <div class="activity-label">Last exchange</div>
          <div class="activity-text">${esc(s.lastSummary || "...")}</div>
        </div>
        <div class="agent-footer">
          <div class="footer-meta">${s.messageCount} msg · ${fmtDate(s.lastUpdated)}</div>
          ${sparkline(s.messageCount, s.isActive)}
        </div>
      </div>
    `
      )
      .join("")}
  </div>`;

  content.querySelectorAll(".agent-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = (card as HTMLElement).dataset.id!;
      selectedSessionId = id;
      renderAgentGrid();
      showDetailPanel(id);
    });
  });
}

async function showDetailPanel(sessionId: string) {
  const p = groups[activeProjectIdx];
  const session = p?.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const panel = document.getElementById("detail-panel")!;
  panel.classList.remove("hidden");
  document.getElementById("detail-name")!.textContent = session.preview.slice(0, 40) || "Session";
  document.getElementById("detail-id")!.textContent = sessionId.slice(0, 12) + "...";

  const body = document.getElementById("detail-body")!;
  body.innerHTML = `<div class="loading">Loading...</div>`;

  // Load agents
  let agents: AgentMeta[] = [];
  try {
    agents = await fetchAgents(sessionId);
  } catch {}

  body.innerHTML = `
    <div>
      <div class="detail-section-label">Status</div>
      <div class="kv-row"><span class="kv-key">State</span><span class="kv-val">${session.isActive ? "running" : "idle"}</span></div>
      <div class="kv-row"><span class="kv-key">Model</span><span class="kv-val">${esc(session.model)}</span></div>
      <div class="kv-row"><span class="kv-key">Messages</span><span class="kv-val">${session.messageCount}</span></div>
      <div class="kv-row"><span class="kv-key">Sub-agents</span><span class="kv-val">${agents.length}</span></div>
      <div class="kv-row"><span class="kv-key">Updated</span><span class="kv-val">${fmtDate(session.lastUpdated)}</span></div>
    </div>

    ${agents.length > 0 ? `
    <div>
      <div class="detail-section-label">Sub-agents</div>
      ${agents.map((a) => `
        <div class="log-item">
          <div class="log-time" style="font-weight:500;color:var(--text)">${esc(a.name)}</div>
          <div class="log-msg">${a.messageCount} msg · ${esc(a.preview.slice(0, 50))}</div>
        </div>
      `).join("")}
    </div>
    ` : ""}

    ${session.lastSummary ? `
    <div>
      <div class="detail-section-label">Last exchange</div>
      <div class="log-item">
        <div class="log-msg">${esc(session.lastSummary)}</div>
      </div>
    </div>
    ` : ""}

    <div>
      <div class="detail-section-label">Actions</div>
      <button class="action-btn primary" id="btn-open-chat">Open Chat</button>
    </div>
  `;

  document.getElementById("btn-open-chat")?.addEventListener("click", () => {
    showChat(sessionId);
    // Switch tab
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab")[1]?.classList.add("active");
  });
}

function showChat(sessionId: string, isNew = false) {
  selectedSessionId = sessionId;
  const content = document.getElementById("main-content")!;
  content.className = "";
  content.style.cssText = "flex:1;overflow-y:auto;padding:16px 20px;";
  renderChatView(content, sessionId, () => currentModel, () => {}, isNew);
}

async function startNewChat() {
  try {
    const id = await createSession();
    showChat(id, true);
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab")[1]?.classList.add("active");
  } catch {
    alert("Failed to create session");
  }
}

function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
  document.getElementById("sidebar-overlay")?.classList.toggle("open");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-overlay")?.classList.remove("open");
}

const TASK_CATEGORY_COLORS: Record<string, string> = {
  Explore: "#1D9E75", Research: "#378ADD", Plan: "#7C5CFC", Code: "#BA7517",
  Review: "#D4537E", Test: "#E06C45", Fix: "#FF5555", Deploy: "#22AA88",
  Search: "#4488CC", Refactor: "#AA77DD", Docs: "#66AAAA", Security: "#FF6644",
  Compliance: "#DDAA33", SNS: "#DD55AA", Notification: "#55AADD",
  "Claude Code": "#CC8833", General: "#888899",
};

function getCategoryColor(cat: string): string {
  return TASK_CATEGORY_COLORS[cat] || "#888899";
}

async function showAgentsOverview() {
  const content = document.getElementById("main-content")!;
  content.className = "agent-grid-area";
  content.innerHTML = `<div class="loading">Loading agent map...</div>`;

  // Fetch data in parallel
  const [memories] = await Promise.all([fetchMemories()]);

  // Collect agent stats per project
  const projectStats = await Promise.all(
    groups.map(async (g, i) => {
      const totalAgents = g.sessions.reduce((n, s) => n + s.agentCount, 0);
      const activeCount = g.sessions.filter((s) => s.isActive).length;

      const allAgents: AgentMeta[] = [];
      for (const s of g.sessions.filter((s) => s.agentCount > 0)) {
        try {
          const agents = await fetchAgents(s.id);
          allAgents.push(...agents);
        } catch {}
      }

      // Group agents by task category
      const byCategory = new Map<string, AgentMeta[]>();
      for (const a of allAgents) {
        const cat = a.taskCategory || "General";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(a);
      }

      // Memory info for this project
      const mem = memories.find((m) => m.project === g.project);

      return { group: g, idx: i, totalAgents, activeCount, allAgents, byCategory, memory: mem };
    })
  );

  const grandTotalAgents = projectStats.reduce((n, p) => n + p.totalAgents, 0);
  const grandTotalSessions = groups.reduce((n, g) => n + g.sessions.length, 0);
  const grandTotalMemory = memories.reduce((n, m) => n + m.fileCount, 0);

  content.innerHTML = `
    <div class="org-chart">
      <!-- Root node -->
      <div class="org-level org-root-level">
        <div class="org-node org-root">
          <div class="org-node-icon" style="background:var(--accent)">CH</div>
          <div class="org-node-info">
            <div class="org-node-name">claude-hub</div>
            <div class="org-node-meta">${groups.length} projects · ${grandTotalSessions} sessions · ${grandTotalAgents} agents · ${grandTotalMemory} memory files</div>
          </div>
        </div>
      </div>

      <div class="org-connector-v"></div>
      <div class="org-connector-h-wrapper">
        <div class="org-connector-h" style="width:${Math.max(60, groups.length * 20)}%"></div>
      </div>

      <!-- Project level -->
      <div class="org-level org-projects-level">
        ${projectStats.map((ps) => `
          <div class="org-branch">
            <div class="org-connector-v"></div>
            <div class="org-node org-project-node">
              <div class="org-node-icon" style="background:${getProjectColor(ps.idx)}">
                ${esc(ps.group.project.slice(0, 2).toUpperCase())}
              </div>
              <div class="org-node-info">
                <div class="org-node-name">${esc(ps.group.project)}</div>
                <div class="org-node-meta">
                  ${ps.activeCount > 0 ? `<span class="pulse pulse-green"></span>` : ""}
                  ${ps.group.sessions.length} sessions · ${ps.totalAgents} agents
                  ${ps.memory && ps.memory.fileCount > 0 ? `· <span class="memory-badge">${ps.memory.fileCount} memory</span>` : ""}
                </div>
              </div>
            </div>

            ${ps.byCategory.size > 0 ? `
              <div class="org-connector-v-sm"></div>
              <div class="org-task-groups">
                ${Array.from(ps.byCategory.entries()).map(([category, agents]) => `
                  <div class="org-task-group">
                    <div class="org-task-header">
                      <span class="org-task-badge" style="background:${getCategoryColor(category)}">${esc(category)}</span>
                      <span class="org-task-count">${agents.length} agent${agents.length > 1 ? "s" : ""}</span>
                    </div>
                    <div class="org-agents-tree">
                      ${agents.map((a, ai) => `
                        <div class="org-agent-leaf">
                          <div class="org-tree-line ${ai === agents.length - 1 ? "last" : ""}"></div>
                          <div class="org-node org-agent-node">
                            <div class="org-agent-icon" style="border-color:${getCategoryColor(category)}">A</div>
                            <div class="org-node-info">
                              <div class="org-agent-name">${esc(a.name)}</div>
                              <div class="org-node-meta">${a.messageCount} msg · ${esc(a.preview.slice(0, 40))}${a.preview.length > 40 ? "..." : ""}</div>
                            </div>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  </div>
                `).join("")}
              </div>
            ` : `
              <div class="org-connector-v-sm"></div>
              <div class="org-task-groups">
                <div class="org-no-agents">No sub-agents</div>
              </div>
            `}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

const PROJECT_COLORS = ["#1D9E75", "#378ADD", "#BA7517", "#D4537E", "#7C5CFC", "#E06C45"];
function getProjectColor(idx: number): string {
  return PROJECT_COLORS[idx % PROJECT_COLORS.length];
}

init();
