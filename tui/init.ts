import { text, isCancel, confirm } from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function maskKey(key: string): string {
  const trimmed = (key ?? "").trim();
  if (!trimmed) return "(empty)";
  if (trimmed.length <= 12) return "********";
  return trimmed.slice(0, 8) + "********" + trimmed.slice(-4);
}

export async function runInitCommand() {
  console.log(chalk.bold.cyan("\n╔══════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║           GhoshClaw First-Time Setup         ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════════════╝\n"));

  console.log(chalk.bold("🔒 Security Notice\n"));
  console.log(chalk.gray(" • Your API keys are stored ONLY on your local computer."));
  console.log(chalk.gray(" • They are NOT uploaded to the GhoshClaw developer."));
  console.log(chalk.gray(" • They are used only to communicate with the AI providers you configure."));
  console.log(chalk.gray(" • You can edit or delete them at any time.\n"));

  console.log(chalk.bold("Storage location:"));
  console.log(chalk.cyan(`   Windows: %USERPROFILE%\\.ghoshclaw\\.env`));
  console.log(chalk.cyan(`   macOS/Linux: ~/.ghoshclaw/.env\n`));

  const proceed = await confirm({
    message: "Do you want to continue?",
    initialValue: true,
  });

  if (isCancel(proceed) || !proceed) {
    return abort();
  }

  console.log(chalk.bold("\nThe following configuration values will be set up:\n"));
  console.log(chalk.gray("  [ ] OPENROUTER_API_KEY"));
  console.log(chalk.gray("  [ ] OPENROUTER_DEFAULT_MODEL"));
  console.log(chalk.gray("  [ ] GROQ_API_KEY"));
  console.log(chalk.gray("  [ ] GROQ_DEFAULT_MODEL"));
  console.log(chalk.gray("  [ ] FIRECRAWL_API_KEY (optional)"));
  console.log(chalk.gray("  [ ] TELEGRAM_BOT_TOKEN (optional)"));
  console.log(chalk.gray("  [ ] TELEGRAM_OWNER_ID (optional)\n"));

  const configDir = path.join(os.homedir(), ".ghoshclaw");
  const configPath = path.join(configDir, ".env");
  
  if (fs.existsSync(configPath)) {
    const overwrite = await confirm({
      message: "Global configuration already exists. Do you want to overwrite it?",
      initialValue: false,
    });
    if (isCancel(overwrite) || !overwrite) {
      console.log(chalk.yellow("\nSetup aborted. Existing settings preserved.\n"));
      return;
    }
  }

  // 1. OPENROUTER_API_KEY
  const openrouterKeyInput = await text({
    message: "Enter your OPENROUTER_API_KEY (press Enter to skip):",
    placeholder: "sk-or-v1-xxxx...",
  });
  if (isCancel(openrouterKeyInput)) return abort();
  const openrouterKey = (openrouterKeyInput ?? "").trim();

  // 2. OPENROUTER_DEFAULT_MODEL
  let openrouterModel = "";
  if (openrouterKey) {
    const modelInput = await text({
      message: "Enter your OPENROUTER_DEFAULT_MODEL:",
      placeholder: "meta-llama/llama-3.3-70b-instruct",
      initialValue: "meta-llama/llama-3.3-70b-instruct",
    });
    if (isCancel(modelInput)) return abort();
    openrouterModel = (modelInput ?? "").trim();
  }

  // 3. GROQ_API_KEY
  const groqKeyInput = await text({
    message: "Enter your GROQ_API_KEY (press Enter to skip):",
    placeholder: "gsk_xxxx...",
  });
  if (isCancel(groqKeyInput)) return abort();
  const groqKey = (groqKeyInput ?? "").trim();

  // 4. GROQ_DEFAULT_MODEL
  let groqModel = "";
  if (groqKey) {
    const modelInput = await text({
      message: "Enter your GROQ_DEFAULT_MODEL:",
      placeholder: "llama-3.3-70b-versatile",
      initialValue: "llama-3.3-70b-versatile",
    });
    if (isCancel(modelInput)) return abort();
    groqModel = (modelInput ?? "").trim();
  }

  // Check if at least one API key is provided
  if (!openrouterKey && !groqKey) {
    console.log(chalk.bold.red("\n❌ Error: You must configure at least one active provider (OpenRouter or Groq) to use Ghoshclaw!\n"));
    const retry = await confirm({
      message: "Would you like to try setup again?",
      initialValue: true,
    });
    if (retry && !isCancel(retry)) {
      return runInitCommand();
    } else {
      return abort();
    }
  }

  // 5. FIRECRAWL_API_KEY
  const firecrawlKeyInput = await text({
    message: "Enter your FIRECRAWL_API_KEY (press Enter to skip):",
    placeholder: "fc-xxxx...",
  });
  if (isCancel(firecrawlKeyInput)) return abort();
  const firecrawlKey = (firecrawlKeyInput ?? "").trim();

  // 6. TELEGRAM_BOT_TOKEN
  const tgTokenInput = await text({
    message: "Enter your TELEGRAM_BOT_TOKEN (press Enter to skip):",
    placeholder: "123456:ABC...",
  });
  if (isCancel(tgTokenInput)) return abort();
  const tgToken = (tgTokenInput ?? "").trim();

  // 7. TELEGRAM_OWNER_ID
  let tgOwnerId = "";
  if (tgToken) {
    const tgOwnerInput = await text({
      message: "Enter your TELEGRAM_OWNER_ID (press Enter to skip):",
      placeholder: "987654321...",
    });
    if (isCancel(tgOwnerInput)) return abort();
    tgOwnerId = (tgOwnerInput ?? "").trim();
  }

  const envLines = [
    `OPENROUTER_API_KEY=${openrouterKey}`,
    `OPENROUTER_DEFAULT_MODEL=${openrouterModel}`,
    `GROQ_API_KEY=${groqKey}`,
    `GROQ_DEFAULT_MODEL=${groqModel}`,
    `FIRECRAWL_API_KEY=${firecrawlKey}`,
    `TELEGRAM_BOT_TOKEN=${tgToken}`,
    `TELEGRAM_OWNER_ID=${tgOwnerId}`,
  ];

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, envLines.join("\n"), "utf8");

    // Assign in-memory so they are immediately available during this execution
    process.env.OPENROUTER_API_KEY = openrouterKey;
    process.env.OPENROUTER_DEFAULT_MODEL = openrouterModel;
    process.env.GROQ_API_KEY = groqKey;
    process.env.GROQ_DEFAULT_MODEL = groqModel;
    process.env.FIRECRAWL_API_KEY = firecrawlKey;
    process.env.TELEGRAM_BOT_TOKEN = tgToken;
    process.env.TELEGRAM_OWNER_ID = tgOwnerId;

    console.log(chalk.bold.green(`\n✓ Configuration saved successfully.\n`));
    console.log(chalk.bold("Configured Values (Masked):"));
    console.log(chalk.gray(`  OPENROUTER_API_KEY = ${maskKey(openrouterKey)}`));
    if (openrouterKey) console.log(chalk.gray(`  OPENROUTER_DEFAULT_MODEL = ${openrouterModel}`));
    console.log(chalk.gray(`  GROQ_API_KEY = ${maskKey(groqKey)}`));
    if (groqKey) console.log(chalk.gray(`  GROQ_DEFAULT_MODEL = ${groqModel}`));
    console.log(chalk.gray(`  FIRECRAWL_API_KEY = ${maskKey(firecrawlKey)}`));
    console.log(chalk.gray(`  TELEGRAM_BOT_TOKEN = ${maskKey(tgToken)}`));
    console.log(chalk.gray(`  TELEGRAM_OWNER_ID = ${tgOwnerId || "(empty)"}`));
    console.log();

    console.log(chalk.bold("Location:"));
    console.log(chalk.cyan(`  ${configPath}\n`));
    console.log(chalk.bold.yellow("⚠️  Keep this file private."));
    console.log(chalk.yellow("Do not share it or commit it to Git repositories.\n"));

  } catch (e: any) {
    console.log(chalk.red(`\n❌ Failed to write config file: ${e.message}\n`));
  }
}

function abort() {
  console.log(chalk.yellow("\nOnboarding setup aborted.\n"));
}
