import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
import os from "node:os";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel } from "../../ai";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";
import { logSession, generateReasoningAndMetadata } from "./timeline-logger";

export async function runAgentMode() {
  console.log(chalk.bold("\n🤖 Agent Mode\n"));

  const goal = await text({
    message: "What would you like the agent to do?",
    placeholder: "Concrete task for this codebase…",
  });

  if (isCancel(goal) || !goal.trim()) return;

  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const tools = createAgentTools(executor);

  const { createSpinner } = await import("nanospinner");
  const ragSpinner = createSpinner("Scanning & indexing codebase context...").start();
  const { getCodebaseContext, getDesktopPath } = await import("./rag-engine");
  const context = await getCodebaseContext(config, goal.trim(), executor);
  ragSpinner.success({ text: "Codebase context indexed." });

  const isSystemAccess = process.env.GHOSHCLAW_SYSTEM_ACCESS === "true";
  const homePath = os.homedir();
  const desktopPath = getDesktopPath();

  const systemPrompt = [
    "You are Ghoshclaw, a private, local AI development co-pilot agent.",
    "Always identify yourself as Ghoshclaw.",
    `Workspace root: ${config.codebasePath}`,
    `OS Environment: ${process.platform === 'win32' ? 'Windows (cmd/powershell)' : 'Unix/Linux (sh/bash)'}`,
    `Note: Always use platform-compatible shell commands. On Windows, DO NOT use 'mv', 'rm', or 'cp' in shell executions; use 'move', 'del', or 'copy' (or PowerShell equivalents). Prefer utilizing the structured file tools over shell commands for basic file changes.`,
    "All mutations are staged until approval.",
    "CRITICAL: You must use the tool calling functions to create folders, write files, search files, and execute shell commands. Do not write JSON blocks or code snippets in your text response if you need to execute an action. You MUST call the corresponding tool function instead.",
    `Full System Access: ${isSystemAccess ? 'ENABLED' : 'DISABLED'}`,
    isSystemAccess
      ? `You have FULL access to the user's system outside the workspace sandbox. You can write files or create folders anywhere. The user's Home Directory is: ${homePath} and Desktop is: ${desktopPath}. If the user asks to create files or folders on their Desktop or Home, use these absolute paths.`
      : `You are restricted to the workspace. Do not attempt to access files outside the workspace.`,
    "",
    "Below is the current codebase context retrieved from the user's workspace:",
    context
  ].join("\n");

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: systemPrompt,
    tools,
  });

  const result = await agent.generate({
    prompt: goal.trim(),
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls) {
        const preview = JSON.stringify(tc.input).slice(0, 160);
        console.log(
          chalk.green("  ✓"),
          chalk.bold(String(tc.toolName)),
          chalk.dim(preview + (preview.length >= 160 ? "..." : "")),
        );
      }
    },
  });

  if (result.text?.trim()) console.log(renderTerminalMarkdown(result.text));

  const ok = await runApprovalFlow(tracker);

  // Log to memory timeline if changes were staged
  const pending = tracker.getPendingMutations();
  if (pending.length > 0) {
    const changesDesc = pending.map(p => `${p.type}: ${p.path}`).join("\n");
    const meta = await generateReasoningAndMetadata(goal.trim(), changesDesc);
    logSession(goal.trim(), meta.reasoning, pending, ok ? "approved" : "rejected", {
      confidence: meta.confidence,
      risk: meta.risk,
    });
  }

  if (!ok) return executor.clearStaging();

  const { errors } = executor.applyApprovedFromTracker();

  if (errors.length) {
    console.log(chalk.red("\nSome operations reported errors:\n"));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
  }
  else {
    console.log(chalk.green('\n✓ Applied.\n'));
  }

  executor.clearStaging();
}