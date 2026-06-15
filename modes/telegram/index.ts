import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTelegramMode() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;

  const bot = new Telegraf(token!);
  registerHandlers(bot);

  try {
    await bot.telegram.sendMessage(ownerId!, WELCOME, { parse_mode: "Markdown" });
    console.log(chalk.green("Sent welcome message to Telegram.\n"));
  } catch (error: any) {
    console.log(chalk.yellow("\n⚠️  Could not send startup message automatically."));
    console.log(chalk.dim("This happens if you haven't started a chat with the bot yet on Telegram."));
    console.log(chalk.cyan("👉 Action: Please open Telegram, search for your bot, and click 'Start' (or send /start).\n"));
  }

  bot.launch();
  console.log(chalk.green("Telegram bot is running."));
  console.log(chalk.cyan("👉 Press ENTER in this terminal to stop the bot and return to the main menu.\n"));

  // Wait for Enter keypress to stop bot and return to main menu
  await new Promise<void>((resolve) => {
    const onData = (data: Buffer) => {
      if (data[0] === 13 || data[0] === 10) {
        process.stdin.removeListener("data", onData);
        try {
          bot.stop();
        } catch (e) {}
        resolve();
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });

  console.log(chalk.yellow("\nStopping Telegram bot... returning to main menu.\n"));
  await delay(1000);
}
