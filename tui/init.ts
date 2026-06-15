import { text, isCancel, confirm } from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function runInitCommand() {
  console.log(chalk.bold.cyan("\n🚀 Ghoshclaw Onboarding & Global Configuration Setup\n"));
  
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

  const groqKey = await text({
    message: "Enter your GROQ_API_KEY:",
    placeholder: "gsk_xxxx...",
  });
  if (isCancel(groqKey)) return abort();

  const openrouterKey = await text({
    message: "Enter your OPENROUTER_API_KEY:",
    placeholder: "sk-or-xxxx...",
  });
  if (isCancel(openrouterKey)) return abort();

  const firecrawlKey = await text({
    message: "Enter your FIRECRAWL_API_KEY (Optional):",
    placeholder: "fc-xxxx...",
  });
  if (isCancel(firecrawlKey)) return abort();

  const tgToken = await text({
    message: "Enter your TELEGRAM_BOT_TOKEN (Optional):",
    placeholder: "123456:ABC...",
  });
  if (isCancel(tgToken)) return abort();

  const tgOwnerId = await text({
    message: "Enter your TELEGRAM_OWNER_ID (Optional):",
    placeholder: "987654321...",
  });
  if (isCancel(tgOwnerId)) return abort();

  const envLines = [
    `GROQ_API_KEY=${(groqKey ?? '').trim()}`,
    `OPENROUTER_API_KEY=${(openrouterKey ?? '').trim()}`,
    `OPENROUTER_DEFAULT_MODEL=meta-llama/llama-3.3-70b-instruct`,
    `FIRECRAWL_API_KEY=${(firecrawlKey ?? '').trim()}`,
    `TELEGRAM_BOT_TOKEN=${(tgToken ?? '').trim()}`,
    `TELEGRAM_OWNER_ID=${(tgOwnerId ?? '').trim()}`,
  ];

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, envLines.join("\n"), "utf8");
    console.log(chalk.bold.green(`\n✅ Global configuration saved successfully at:`));
    console.log(chalk.cyan(`   ${configPath}\n`));
  } catch (e: any) {
    console.log(chalk.red(`\n❌ Failed to write config file: ${e.message}\n`));
  }
}

function abort() {
  console.log(chalk.yellow("\nOnboarding setup aborted.\n"));
}
