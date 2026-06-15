#!/usr/bin/env node

import { Command } from "commander";
import process from "node:process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import dotenv from "dotenv";

// Load local workspace .env first, then fallback to global .env
dotenv.config();
const globalEnvPath = path.join(os.homedir(), ".ghoshclaw", ".env");
if (fs.existsSync(globalEnvPath)) {
  try {
    const globalConfig = dotenv.parse(fs.readFileSync(globalEnvPath));
    for (const key in globalConfig) {
      if (!process.env[key]) {
        process.env[key] = globalConfig[key];
      }
    }
  } catch (e) {}
}

import { runWakeup } from "./tui/wakeup";
import { runInitCommand } from "./tui/init";

// Global error handlers to suppress the Bun + Telegraf read-only token redaction crash
process.on("uncaughtException", (err) => {
  if (
    err.message?.includes("readonly property") ||
    err.stack?.includes("redactToken")
  ) {
    return; // Suppress the Bun + Telegraf issue
  }
  console.error(err);
});

process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || "";
  const stack = reason?.stack || "";
  if (msg.includes("readonly property") || stack.includes("redactToken")) {
    return; // Suppress the Bun + Telegraf issue
  }
  console.error(reason);
});

const program = new Command();

program
  .name("ghoshclaw")
  .description("Ghoshclaw AI Development co-pilot")
  .version("1.0.0");

program
  .command("wakeup")
  .description("Show the banner and pick cli or telegram mode")
  .action(async () => {
    await runWakeup();
  });

program
  .command("init")
  .description("Initialize global configuration and prompt for AI credentials")
  .action(async () => {
    await runInitCommand();
  });

await program.parseAsync(process.argv);