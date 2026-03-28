# claude-hub

A local dashboard for [Claude Code](https://claude.ai/code) — browse sessions, chat with Claude, and manage your projects from the browser.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-18%2B-green)
![TypeScript](https://img.shields.io/badge/TypeScript-Vanilla-blue)

## Screenshots

### Session Browser
Browse all Claude Code sessions grouped by project, with live status indicators and conversation previews.

![Session Browser](docs/screenshots/sessions.png)

### Agent Map
Visualize sub-agents grouped by task category (Explore, Code, Review, etc.) with real agent names from tool metadata. Memory file counts shown per project.

![Agent Map](docs/screenshots/agent-map.png)

### Live Chat
Continue conversations or start new ones via the Anthropic API, with streaming responses and code highlighting.

![Live Chat](docs/screenshots/chat.png)

---

## Features

- **Session browser** — View all Claude Code sessions grouped by project
- **Live chat** — Continue conversations or start new ones via the Anthropic API
- **Agent Map** — Visualize sub-agents grouped by task category with real names from tool metadata
- **Memory tracking** — Show memory file counts per project
- **Image attachments** — Paste, drag & drop, or click to attach images
- **Model switcher** — Switch between Opus, Sonnet, and Haiku
- **Quick Start bar** — Configurable command reference with click-to-copy
- **Sites bar** — Track deployed sites per project, add/remove from UI
- **QR code** — Share your dashboard URL for mobile access
- **Light/Dark mode** — Toggle with localStorage persistence
- **Drag & drop reorder** — Rearrange projects in the sidebar
- **IME-safe input** — Japanese/CJK input won't trigger accidental sends

---

## Quick Start

### Prerequisites

| Requirement | How to get it |
|---|---|
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) — download the LTS version |
| **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com/) — sign up and create a key |
| **Claude Code** | [claude.ai/code](https://claude.ai/code) — install the CLI (`npm install -g @anthropic-ai/claude-code`) |

### Step-by-step Setup

#### 1. Clone the repository

```bash
git clone https://github.com/gdalabs/claude-hub.git
cd claude-hub
```

#### 2. Install dependencies

```bash
npm install
```

> **Note:** If you see permission errors on macOS, try: `npm install --cache /tmp/npm-cache`

#### 3. Set up your API key

```bash
cp .env.example .env
```

Open `.env` in your editor and replace the placeholder with your real key:

```
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

> **Important:** Never share your API key or commit it to git. The `.env` file is gitignored.

#### 4. Start the dashboard

```bash
npm run dev
```

You should see:

```
claude-hub running on http://127.0.0.1:3456
  Local:     http://localhost:3456
```

#### 5. Open in your browser

Go to [http://localhost:5174](http://localhost:5174)

That's it! You should see your Claude Code sessions listed in the sidebar.

---

## Configuration

### hub.config.json

On first launch, a `hub.config.json` file is auto-generated. This is your personal config — it's gitignored so it won't be committed.

You can also copy the example to get started:

```bash
cp hub.config.example.json hub.config.json
```

Edit `hub.config.json` to customize two things:

#### Sites (per project)

Links shown in the bar below tabs. Add your deployed apps, docs, etc.

```json
{
  "sites": {
    "my-project": [
      { "name": "My App", "url": "https://my-app.example.com/", "emoji": "🚀" },
      { "name": "Docs", "url": "https://docs.example.com/", "emoji": "📖" }
    ]
  }
}
```

- The key (`"my-project"`) must match the project folder name shown in the sidebar
- You can also add/remove sites directly from the UI (click the `+` button)

#### Quick Start commands

Commands shown in the collapsible Quick Start bar at the top. Click to copy.

```json
{
  "quickstart": [
    { "section": "My Projects" },
    { "label": "My App", "cmd": "cd ~/projects/my-app && claude --enable-auto-mode" },
    { "label": "Backend", "cmd": "cd ~/projects/backend && claude --enable-auto-mode" },

    { "section": "Claude Code Commands" },
    { "cmd": "/init", "display": "/init — Create CLAUDE.md" },
    { "cmd": "/cost", "display": "/cost — Check token usage" },
    { "cmd": "/help", "display": "/help — Show help" },

    { "section": "Utilities" },
    { "label": "Kill ports", "cmd": "lsof -ti :5174 :3456 | xargs kill" }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `section` | — | Section header (mutually exclusive with cmd) |
| `label` | — | Display name above the command |
| `cmd` | Yes (if not section) | Command to copy on click |
| `display` | — | Display text (defaults to `cmd` if omitted) |

---

## Architecture

```
claude-hub/
├── server/                  # Hono + Node.js backend (port 3456)
│   ├── index.ts             # API routes
│   ├── chat.ts              # Anthropic SDK streaming + session logging
│   ├── sessions.ts          # Reads ~/.claude/ session files
│   ├── config.ts            # hub.config.json read/write
│   └── types.ts             # Shared TypeScript types
├── src/                     # Vite + TypeScript frontend (port 5174)
│   ├── main.ts              # App shell, sidebar, session grid, org chart
│   ├── chat-view.ts         # Chat UI with streaming + image support
│   ├── api.ts               # Fetch wrappers for /api/*
│   ├── sites.ts             # Site management (config + localStorage)
│   ├── qrcode.ts            # QR code SVG generator (zero dependencies)
│   ├── markdown.ts          # Marked + highlight.js setup
│   ├── types.ts             # Frontend TypeScript types
│   └── style.css            # Complete styling (~1,800 lines)
├── hub.config.json          # Your personal config (gitignored)
├── hub.config.example.json  # Example config (committed)
├── .env                     # API key (gitignored)
└── .env.example             # API key template (committed)
```

**Stack:** Vite, TypeScript (Vanilla), Hono, Anthropic SDK — no React, no Vue, no heavy frameworks.

### How it works

1. The **server** reads Claude Code's local session files from `~/.claude/projects/` and `~/.claude/sessions/`
2. Sessions are grouped by project and exposed via REST API
3. The **frontend** fetches session data and renders a dashboard UI
4. Chat messages are sent to the Anthropic API and streamed back via SSE
5. Both user and assistant messages are logged to JSONL files for session continuity

---

## Remote Access

The API server binds to `127.0.0.1` (localhost only) by default for security. To allow access from other devices on your local network, add to `.env`:

```
HOST=0.0.0.0
```

For secure remote access from anywhere, we recommend [Tailscale](https://tailscale.com/):

1. Install Tailscale on your Mac and mobile device
2. Access `http://<tailscale-ip>:5174` from anywhere
3. Use the **QR** button in the header for quick mobile access

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (frontend :5174 + API :3456) |
| `npm run build` | Build for production |
| `npm start` | Run production server |

---

## FAQ

### Where does claude-hub read session data from?

It reads from `~/.claude/projects/` (conversation logs) and `~/.claude/sessions/` (active session PIDs). These directories are created automatically by Claude Code.

### I see "0 sessions" — what's wrong?

Make sure you've used Claude Code at least once with a project. Run `ls ~/.claude/projects/` to check if session data exists.

### Can I use this without Claude Code installed?

Partially — the chat feature works standalone (it talks directly to the Anthropic API), but the session browser requires Claude Code session files.

### How do I change the port?

Set environment variables in `.env`:

```
PORT=4000       # API server port (default: 3456)
HOST=0.0.0.0    # Bind address (default: 127.0.0.1, set to 0.0.0.0 for network access)
```

Then update `vite.config.ts` proxy target if you changed `PORT`.

### Is my API key safe?

Yes. The API key is only used server-side (`server/chat.ts`). It's never sent to the browser. The `.env` file is gitignored.

### Can multiple people use the same instance?

The dashboard is designed for single-user, local use. It reads your local `~/.claude/` directory, so each user should run their own instance.

### How do I update?

```bash
git pull
npm install
npm run dev
```

Your `hub.config.json` and `.env` are gitignored, so they won't be overwritten.

---

## 한국어 가이드

### claude-hub란?

[Claude Code](https://claude.ai/code) 세션을 브라우저에서 관리할 수 있는 로컬 대시보드입니다. 세션 목록 조회, 채팅 이어하기, 서브 에이전트 시각화 등을 제공합니다.

### 설치 방법

#### 필수 사항

- **Node.js 18 이상** — [nodejs.org](https://nodejs.org/)에서 LTS 버전 다운로드
- **Anthropic API 키** — [console.anthropic.com](https://console.anthropic.com/)에서 발급
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`로 설치

#### 설치 단계

```bash
# 1. 저장소 클론
git clone https://github.com/gdalabs/claude-hub.git
cd claude-hub

# 2. 의존성 패키지 설치
npm install
# macOS에서 권한 오류 발생 시: npm install --cache /tmp/npm-cache

# 3. API 키 설정
cp .env.example .env
# .env 파일을 열어 ANTHROPIC_API_KEY에 키를 입력

# 4. 실행
npm run dev

# 5. 브라우저에서 열기
# http://localhost:5174
```

### 설정 커스터마이즈

첫 실행 시 `hub.config.json`이 자동 생성됩니다. 이 파일을 수정하여 프로젝트와 명령어를 등록할 수 있습니다.

```bash
# 예제에서 복사
cp hub.config.example.json hub.config.json
```

#### Sites (사이트)

탭 아래에 표시되는 링크 모음입니다. 프로젝트별로 배포된 사이트를 등록할 수 있습니다. UI의 `+` 버튼으로도 추가 가능합니다.

#### Quick Start (빠른 시작)

화면 상단의 접기 가능한 바입니다. 자주 쓰는 명령어를 클릭 한 번으로 복사할 수 있습니다.

```json
{
  "quickstart": [
    { "section": "섹션 이름" },
    { "label": "표시 이름", "cmd": "복사될 명령어" },
    { "cmd": "/help", "display": "/help — 도움말 표시" }
  ]
}
```

### 자주 묻는 질문

**Q: 세션이 표시되지 않습니다**
A: Claude Code를 한 번 이상 프로젝트에서 사용해 주세요. `ls ~/.claude/projects/`로 데이터 존재 여부를 확인할 수 있습니다.

**Q: API 키는 안전한가요?**
A: 네. API 키는 서버 측에서만 사용되며 브라우저로 전송되지 않습니다. `.env` 파일은 gitignore 처리되어 있습니다.

**Q: 스마트폰에서 접속하고 싶습니다**
A: 같은 네트워크 내에서 `http://<PC의 IP 주소>:5174`로 접속할 수 있습니다(`.env`에 `HOST=0.0.0.0` 추가 필요). 외부에서는 [Tailscale](https://tailscale.com/)을 추천합니다.

**Q: 업데이트 방법은?**
A: `git pull && npm install && npm run dev`로 업데이트할 수 있습니다. `hub.config.json`과 `.env`는 gitignore 되어 있어 덮어쓰지 않습니다.

---

## 日本語ガイド

### claude-hub とは？

[Claude Code](https://claude.ai/code) のセッションをブラウザから一元管理できるローカルダッシュボードです。セッション閲覧、チャット続行、サブエージェントの可視化などができます。

### セットアップ手順

#### 必要なもの

- **Node.js 18以上** — [nodejs.org](https://nodejs.org/) からLTS版をダウンロード
- **Anthropic APIキー** — [console.anthropic.com](https://console.anthropic.com/) で取得
- **Claude Code** — `npm install -g @anthropic-ai/claude-code` でインストール

#### 手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/gdalabs/claude-hub.git
cd claude-hub

# 2. 依存パッケージをインストール
npm install
# macOSで権限エラーが出た場合: npm install --cache /tmp/npm-cache

# 3. APIキーを設定
cp .env.example .env
# .env を開いて ANTHROPIC_API_KEY にあなたのキーを入力

# 4. 起動
npm run dev

# 5. ブラウザで開く
# http://localhost:5174
```

### 設定のカスタマイズ

初回起動時に `hub.config.json` が自動生成されます。このファイルを編集して、自分のプロジェクトやコマンドを登録できます。

```bash
# サンプルからコピーして編集
cp hub.config.example.json hub.config.json
```

#### サイト（Sites）

タブの下に表示されるリンク集。プロジェクトごとにデプロイ済みサイトを登録できます。UIの「+」ボタンからも追加可能。

#### Quick Start

画面上部の折りたたみバー。よく使うコマンドをクリックでコピーできます。

```json
{
  "quickstart": [
    { "section": "セクション名" },
    { "label": "表示名", "cmd": "コピーされるコマンド" },
    { "cmd": "/help", "display": "/help — ヘルプ表示" }
  ]
}
```

### よくある質問

**Q: セッションが表示されない**
A: Claude Code を一度でもプロジェクトで使用してください。`ls ~/.claude/projects/` でデータがあるか確認できます。

**Q: APIキーは安全？**
A: はい。APIキーはサーバーサイドでのみ使用され、ブラウザには送信されません。`.env` は gitignore 済みです。

**Q: スマホからアクセスしたい**
A: 同じネットワーク内なら `http://<PCのIPアドレス>:5174` でアクセスできます。外出先からは [Tailscale](https://tailscale.com/) を推奨します。ヘッダーの「QR」ボタンでURLのQRコードを表示できます。

**Q: ポートを変えたい**
A: `.env` に `PORT=4000` を追加してください（デフォルトは3456）。

**Q: アップデートするには？**
A: `git pull && npm install && npm run dev` で更新できます。`hub.config.json` と `.env` は gitignore されているので上書きされません。

---

## 中文指南

### 什么是 claude-hub？

[Claude Code](https://claude.ai/code) 的本地浏览器仪表板。可以查看所有会话列表、继续聊天、可视化子代理层级结构等。

### 安装方法

#### 前提条件

- **Node.js 18+** — 从 [nodejs.org](https://nodejs.org/) 下载 LTS 版本
- **Anthropic API 密钥** — 在 [console.anthropic.com](https://console.anthropic.com/) 获取
- **Claude Code** — 使用 `npm install -g @anthropic-ai/claude-code` 安装

#### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/gdalabs/claude-hub.git
cd claude-hub

# 2. 安装依赖包
npm install
# macOS 出现权限错误时: npm install --cache /tmp/npm-cache

# 3. 设置 API 密钥
cp .env.example .env
# 打开 .env 文件，在 ANTHROPIC_API_KEY 中输入你的密钥

# 4. 启动
npm run dev

# 5. 在浏览器中打开
# http://localhost:5174
```

### 自定义配置

首次启动时会自动生成 `hub.config.json`。编辑此文件来注册你的项目和命令。

```bash
# 从示例复制
cp hub.config.example.json hub.config.json
```

#### Sites（站点）

显示在标签页下方的链接集合。可以按项目注册已部署的站点。也可以通过 UI 的 `+` 按钮添加。

#### Quick Start（快速启动）

屏幕顶部可折叠的工具栏。常用命令点击即可复制。

```json
{
  "quickstart": [
    { "section": "分区名称" },
    { "label": "显示名称", "cmd": "要复制的命令" },
    { "cmd": "/help", "display": "/help — 显示帮助" }
  ]
}
```

### 常见问题

**Q: 没有显示会话**
A: 请至少使用一次 Claude Code。可以通过 `ls ~/.claude/projects/` 检查数据是否存在。

**Q: API 密钥安全吗？**
A: 是的。API 密钥仅在服务器端使用，不会发送到浏览器。`.env` 文件已被 gitignore。

**Q: 想从手机访问**
A: 在同一网络内可以通过 `http://<电脑IP地址>:5174` 访问（需要在 `.env` 中添加 `HOST=0.0.0.0`）。远程访问推荐使用 [Tailscale](https://tailscale.com/)。

**Q: 如何更新？**
A: 运行 `git pull && npm install && npm run dev` 即可更新。`hub.config.json` 和 `.env` 已被 gitignore，不会被覆盖。

---

## License

MIT — see [LICENSE](./LICENSE)
