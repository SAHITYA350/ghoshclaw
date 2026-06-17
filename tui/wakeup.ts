import { select, isCancel, confirm } from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
// @ts-ignore
import ansiShadow from "figlet/importable-fonts/ANSI Shadow.js";
import gradient from "gradient-string";
import { createSpinner } from "nanospinner";

import { runCliMode } from "../modes/cli";
import { runTelegramMode } from "../modes/telegram";
import { runInitCommand } from "./init";

// Register the font from the bundled JS module
figlet.parseFont("ANSI Shadow", ansiShadow);

async function ensureCredentials(): Promise<boolean> {
  const hasGroq = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== "";
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim() !== "";

  if (hasGroq || hasOpenRouter) {
    return true;
  }

  console.log(chalk.bold.red("\n❌ GhoshClaw is not configured.\n"));
  console.log(chalk.gray("Run:"));
  console.log(chalk.cyan("    ghoshclaw init\n"));
  console.log(chalk.gray("Your API keys will be stored locally on this computer and will not be shared with the developer.\n"));

  const runSetup = await confirm({
    message: "Would you like to run the onboarding configuration wizard now?",
    initialValue: true,
  });

  if (isCancel(runSetup) || !runSetup) {
    console.log(chalk.red("\nCannot proceed without configuration. Exiting.\n"));
    process.exit(1);
  }

  await runInitCommand();
  
  // Re-verify after setup
  const finalGroq = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== "";
  const finalOpenRouter = !!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim() !== "";
  
  if (finalGroq || finalOpenRouter) {
    return true;
  }
  
  console.log(chalk.red("\nCredentials are still missing or invalid. Exiting.\n"));
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateLogo() {
  const logo = figlet.textSync("ghoshclaw", { 
    font: "ANSI Shadow", 
  });

  const lines = logo.split("\n");
  const width = Math.max(...lines.map((line) => line.length));
  const totalFrames = 70; 

  for (let frame = 0; frame < totalFrames; frame++) {
    console.clear();

    const sweep = Math.floor(
      (frame / totalFrames) * (width + 20)
    );

    for (const line of lines) {
      let rendered = "";

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const distance = Math.abs(i - sweep);

        if (ch === " ") {
          rendered += " ";
          continue;
        }

        if (distance <= 1) {
          rendered += chalk.white.bold(ch);
        } else if (distance <= 3) {
          rendered += chalk.hex("#E9D5FF")(ch);
        } else if (distance <= 6) {
          rendered += chalk.hex("#C4B5FD")(ch);
        } else {
          rendered += chalk.hex("#7F5AF0")(ch);
        }
      }

      console.log(rendered);
    }

    await sleep(100);
  }

  console.clear();

  console.log(
    gradient(["#7F5AF0", "#A78BFA", "#22D3EE"]).multiline(logo)
  );
}

async function showIntro() {
  console.clear();

  await animateLogo();

  console.log(
    chalk.gray(
      "────────────────────────────────────────────────────────────"
    )
  );

  console.log(
    chalk.hex("#A78BFA").bold("   AI Development Toolkit") +
      chalk.gray(" • ") +
      chalk.cyanBright("v2026")
  );

  console.log(
    chalk.gray(
      "────────────────────────────────────────────────────────────"
    )
  );

  console.log();

  const spinner = createSpinner("Initializing services...").start();

  await sleep(1500);

  spinner.success({
    text: chalk.greenBright("System ready"),
  });

  console.log();
}

export async function runWakeup() {
  process.removeAllListeners("SIGINT");

  process.on("SIGINT", () => {
    process.stdout.write("\x1b[?25h");
    console.log(chalk.gray("\nSession terminated.\n"));
    process.exit(0);
  });

  await showIntro();

  await ensureCredentials();

  const systemAccess = await confirm({
    message: "Do you want to grant the agent full system access for this session? (Allows editing files outside the workspace and running arbitrary system commands)",
    initialValue: false,
  });

  if (isCancel(systemAccess)) {
    console.log(chalk.gray("\nSession terminated.\n"));
    process.exit(0);
  }

  process.env.GHOSHCLAW_SYSTEM_ACCESS = systemAccess ? "true" : "false";

  if (systemAccess) {
    console.log(chalk.greenBright("\n🔓 Full System Access granted. The agent can operate outside the workspace (e.g. on Desktop).\n"));
  } else {
    console.log(chalk.cyan("\n🛡️  Sandboxed Mode active. The agent is restricted to files inside the workspace.\n"));
  }

  while (true) {
    process.stdin.resume();

    const mode = await select({
      message: "Choose launch mode",
      options: [
        {
          value: "cli",
          label: "🖥  Interactive CLI",
          hint: "Local AI assistant",
        },
        {
          value: "telegram",
          label: "📱 Telegram Bot",
          hint: "Run with Telegram integration",
        },
        {
          value: "exit",
          label: "✖ Exit",
        },
      ],
    });

    if (isCancel(mode) || mode === "exit") {
      console.log(chalk.gray("\nSession terminated.\n"));
      process.exit(0);
    }

    if (mode === "cli") {
      await runCliMode();
    } else if (mode === "telegram") {
      await runTelegramMode();
    }
  }
}