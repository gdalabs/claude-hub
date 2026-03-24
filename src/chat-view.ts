import { fetchSession, sendMessage } from "./api";
import { renderMarkdown } from "./markdown";
import type { Message, ContentBlock, ImageAttachment } from "./types";

let pendingImages: ImageAttachment[] = [];

function escapeHtml(str: string): string {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
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

function extractToolUses(content: string | ContentBlock[]): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b.type === "tool_use");
}

function extractImages(content: string | ContentBlock[]): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b.type === "image" && b.source);
}

function renderMessage(msg: Message): string {
  const text = extractText(msg.content);
  const tools = extractToolUses(msg.content);
  const images = extractImages(msg.content);
  const isUser = msg.role === "user";

  const imageHtml = images.length
    ? `<div class="message-images">${images
        .map(
          (img) =>
            `<img src="data:${img.source!.media_type};base64,${img.source!.data}" class="chat-image" />`
        )
        .join("")}</div>`
    : "";

  const toolHtml = tools.length
    ? `<div class="tool-uses">${tools
        .map(
          (t) =>
            `<details class="tool-block"><summary>${escapeHtml(t.name ?? "tool")}</summary><pre>${escapeHtml(JSON.stringify(t.input, null, 2))}</pre></details>`
        )
        .join("")}</div>`
    : "";

  return `
    <div class="message ${isUser ? "user" : "assistant"}">
      <div class="message-role">${isUser ? "You" : "Claude"}</div>
      ${imageHtml}
      <div class="message-body">${isUser ? `<p>${escapeHtml(text)}</p>` : renderMarkdown(text)}</div>
      ${toolHtml}
    </div>
  `;
}

export async function renderChatView(
  container: HTMLElement,
  sessionId: string,
  getModel: () => string,
  onBack: () => void,
  isNew = false
) {
  container.innerHTML = `<div class="loading">Loading conversation...</div>`;

  let messages: Message[] = [];
  let project = "New Chat";

  if (!isNew) {
    try {
      const session = await fetchSession(sessionId);
      messages = session.messages;
      project = session.project;
    } catch {
      container.innerHTML = `<div class="loading error">Failed to load session</div>`;
      return;
    }
  }

  function addFiles(files: File[]) {
    let remaining = files.length;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const [header, data] = dataUrl.split(",");
        const media_type = header.match(/:(.*?);/)?.[1] ?? "image/png";
        pendingImages.push({
          data,
          media_type,
          preview_url: URL.createObjectURL(file),
        });
        remaining--;
        if (remaining === 0) renderAll();
      };
      reader.readAsDataURL(file);
    }
  }

  function renderImagePreview(): string {
    if (pendingImages.length === 0) return "";
    return `<div class="image-preview-bar" id="image-preview-bar">${pendingImages
      .map(
        (img, i) =>
          `<div class="image-preview-item">
            <img src="${img.preview_url}" />
            <button class="image-preview-remove" data-idx="${i}">&times;</button>
          </div>`
      )
      .join("")}</div>`;
  }

  function renderAll() {
    container.innerHTML = `
      <div class="chat-header">
        <span class="chat-project">${escapeHtml(project)}</span>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${messages.map(renderMessage).join("")}
      </div>
      ${renderImagePreview()}
      <div class="chat-input-bar">
        <input type="file" id="image-input" accept="image/*" multiple hidden />
        <button id="btn-attach" class="btn-attach" title="Add image">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </button>
        <textarea id="chat-input" placeholder="Message..." rows="1"></textarea>
        <button id="btn-send" class="btn-send">Send</button>
      </div>
    `;

    const input = document.getElementById("chat-input") as HTMLTextAreaElement;
    const sendBtn = document.getElementById("btn-send") as HTMLButtonElement;
    const attachBtn = document.getElementById("btn-attach") as HTMLButtonElement;
    const fileInput = document.getElementById("image-input") as HTMLInputElement;

    // Auto-resize textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 200) + "px";
    });

    // Enter to send, Shift+Enter for newline, ignore during IME composition
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        handleSend();
      }
    });

    sendBtn.addEventListener("click", handleSend);

    // Image attach
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (!fileInput.files) return;
      addFiles(Array.from(fileInput.files));
      fileInput.value = "";
    });

    // Paste image
    input.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    });

    // Drag & drop on chat area
    const chatEl = document.getElementById("chat-messages")!;

    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      chatEl.classList.add("drag-over");
    });

    container.addEventListener("dragleave", (e) => {
      if (!container.contains(e.relatedTarget as Node)) {
        chatEl.classList.remove("drag-over");
      }
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
      chatEl.classList.remove("drag-over");
      const files: File[] = [];
      if (e.dataTransfer?.files) {
        for (const file of Array.from(e.dataTransfer.files)) {
          if (file.type.startsWith("image/")) {
            files.push(file);
          }
        }
      }
      if (files.length > 0) addFiles(files);
    });

    // Remove preview images
    document.querySelectorAll(".image-preview-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.idx);
        URL.revokeObjectURL(pendingImages[idx].preview_url);
        pendingImages.splice(idx, 1);
        renderAll();
      });
    });

    // Scroll to bottom
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function handleSend() {
    const input = document.getElementById("chat-input") as HTMLTextAreaElement;
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;

    // Build user content with images
    const imageBlocks: ContentBlock[] = pendingImages.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.media_type, data: img.data },
    }));
    const sentImages = pendingImages.map((img) => ({ data: img.data, media_type: img.media_type }));

    // Cleanup previews
    pendingImages.forEach((img) => URL.revokeObjectURL(img.preview_url));
    pendingImages = [];

    if (imageBlocks.length > 0) {
      const blocks: ContentBlock[] = [
        ...imageBlocks,
        ...(text ? [{ type: "text" as const, text }] : []),
      ];
      messages.push({ role: "user", content: blocks });
    } else {
      messages.push({ role: "user", content: text });
    }

    // Add placeholder assistant message
    messages.push({ role: "assistant", content: "" });
    renderAll();

    const sendBtn = document.getElementById("btn-send") as HTMLButtonElement;
    const inputEl = document.getElementById("chat-input") as HTMLTextAreaElement;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    const assistantIdx = messages.length - 1;

    await sendMessage(
      sessionId,
      text,
      getModel(),
      (chunk) => {
        // Update streaming message
        const current = messages[assistantIdx];
        if (typeof current.content === "string") {
          current.content += chunk;
        }

        // Update DOM directly for performance
        const chatEl = document.getElementById("chat-messages")!;
        const lastMsg = chatEl.querySelector(
          ".message.assistant:last-child .message-body"
        );
        if (lastMsg) {
          lastMsg.innerHTML = renderMarkdown(current.content as string);
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      },
      () => {
        // Done
        renderAll();
      },
      (err) => {
        messages[assistantIdx].content = `Error: ${err}`;
        renderAll();
      },
      sentImages.length > 0 ? sentImages : undefined
    );
  }

  renderAll();
}
