import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import gradient from "gradient-string";
import { createSpinner } from "nanospinner";

import { runCliMode } from "../modes/cli";
import { runTelegramMode } from "../modes/telegram";

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