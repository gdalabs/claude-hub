#!/usr/bin/env node

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const REPO_URL = "https://github.com/gdalabs/claude-hub.git";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function log(msg: string) {
  console.log(msg);
}

function step(msg: string) {
  log(`\n${GREEN}>${RESET} ${msg}`);
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${CYAN}?${RESET} ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log("");
  log(`${BOLD}  claude-hub${RESET} — Local dashboard for Claude Code`);
  log(`${DIM}  https://github.com/gdalabs/claude-hub${RESET}`);
  log("");

  // 1. Project name
  const argName = process.argv[2];
  const rawName = argName || (await ask("Project name (claude-hub):")) || "claude-hub";

  // Sanitize project name: only allow alphanumeric, hyphens, underscores, dots
  const projectName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (projectName !== rawName) {
    log(`  ${DIM}Sanitized name: ${projectName}${RESET}`);
  }
  const projectDir = resolve(projectName);

  if (existsSync(projectDir)) {
    const files = existsSync(join(projectDir, "package.json"));
    if (files) {
      log(`\n${BOLD}Directory already exists with package.json.${RESET}`);
      const overwrite = await ask("Overwrite? (y/N):");
      if (overwrite.toLowerCase() !== "y") {
        log("Aborted.");
        process.exit(0);
      }
      rmSync(projectDir, { recursive: true });
    }
  }

  // 2. Clone repo
  step("Downloading claude-hub...");

  if (hasCommand("git")) {
    try {
      execSync(`git clone --depth 1 -- ${JSON.stringify(REPO_URL)} ${JSON.stringify(projectDir)}`, {
        stdio: "pipe",
      });
      // Remove .git so it's a fresh project
      rmSync(join(projectDir, ".git"), { recursive: true, force: true });
      // Remove create-claude-hub dir (not needed in the scaffolded project)
      rmSync(join(projectDir, "create-claude-hub"), { recursive: true, force: true });
    } catch (err) {
      log("  git clone failed, trying tarball...");
      downloadTarball(projectDir);
    }
  } else {
    downloadTarball(projectDir);
  }

  log(`  ${DIM}Downloaded to ${projectDir}${RESET}`);

  // 3. API key
  step("Setting up Anthropic API key...");

  const envPath = join(projectDir, ".env");
  let apiKey = process.env.ANTHROPIC_API_KEY || "";

  if (apiKey) {
    log(`  ${DIM}Found ANTHROPIC_API_KEY in environment${RESET}`);
  } else {
    apiKey = await ask("Anthropic API key (sk-ant-...):") ;
  }

  if (apiKey) {
    writeFileSync(envPath, `ANTHROPIC_API_KEY=${apiKey}\n`);
    log(`  ${DIM}Saved to .env${RESET}`);
  } else {
    log(`  ${DIM}Skipped — you can add it later to .env${RESET}`);
    writeFileSync(envPath, `# ANTHROPIC_API_KEY=sk-ant-...\n`);
  }

  // 4. Config
  step("Creating config...");
  const configExample = join(projectDir, "hub.config.example.json");
  const configDest = join(projectDir, "hub.config.json");

  if (existsSync(configExample) && !existsSync(configDest)) {
    copyFileSync(configExample, configDest);
    log(`  ${DIM}Created hub.config.json from example${RESET}`);
  } else {
    log(`  ${DIM}hub.config.json already exists${RESET}`);
  }

  // 5. Install dependencies
  step("Installing dependencies...");
  const npmArgs = process.platform === "darwin" ? "--cache /tmp/npm-cache" : "";
  try {
    execSync(`npm install ${npmArgs}`, {
      cwd: projectDir,
      stdio: "inherit",
    });
  } catch {
    log("  npm install failed. You can run it manually later.");
  }

  // 6. Done!
  log("");
  log(`${GREEN}${BOLD}  Done!${RESET} claude-hub is ready.`);
  log("");
  log(`  ${DIM}cd ${projectName}${RESET}`);
  log(`  ${DIM}npm run dev${RESET}`);
  log("");
  log(`  Then open ${CYAN}http://localhost:5174${RESET}`);
  log(`  Use the ${BOLD}Settings${RESET} tab to add your projects.`);
  log("");

  // 7. Auto-start?
  const start = await ask("Start now? (Y/n):");
  if (start.toLowerCase() !== "n") {
    step("Starting claude-hub...");
    log(`  Opening ${CYAN}http://localhost:5174${RESET}`);
    log(`  ${DIM}Press Ctrl+C to stop${RESET}\n`);

    const child = spawn("npm", ["run", "dev"], {
      cwd: projectDir,
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });

    // Forward signals
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
  }
}

function downloadTarball(destDir: string) {
  if (!hasCommand("curl")) {
    log("Error: neither git nor curl is available. Please install git.");
    process.exit(1);
  }

  mkdirSync(destDir, { recursive: true });
  const tarball = "https://github.com/gdalabs/claude-hub/archive/refs/heads/main.tar.gz";

  try {
    execSync(
      `curl -sL ${JSON.stringify(tarball)} | tar xz --strip-components=1 -C ${JSON.stringify(destDir)}`,
      { stdio: "pipe" }
    );
    // Remove create-claude-hub dir
    rmSync(join(destDir, "create-claude-hub"), { recursive: true, force: true });
  } catch {
    log("Error: failed to download tarball.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
