import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import os from "node:os";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { createAgentTools } from "../agent/agent-tools.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import { runApprovalFlow } from "../agent/approval.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { generatePlan } from "./planner.ts";
import { printPlan, selectSteps } from "./selection.ts";
import type { PlanStep } from "./types.ts";
import { createWebTools } from "./web-tools.ts";
import { logSession, generateReasoningAndMetadata } from "../agent/timeline-logger";


function stepPrompt(goal: string, step: PlanStep): string {
  return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join('\n');
}


export async function runPlanMode(): Promise<void> {
  console.log(chalk.bold("\n🧭 Plan Mode\n"));

  const goal = await text({ message: "What is your goal?" });
  if (isCancel(goal) || !goal.trim()) return;

  const plan = await generatePlan(goal);

  printPlan(plan);

  const selected = await selectSteps(plan);
  if (selected.length === 0) return;

  const proceed = await confirm({
    message: `Execute ${selected.length} step(s)`,
    initialValue: true,
  });

  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);


  const tools = {
    ...createAgentTools(executor),
    ...createWebTools(tracker)
  };

  const { createSpinner } = await import("nanospinner");
  const ragSpinner = createSpinner("Scanning & indexing codebase context...").start();
  const { getCodebaseContext, getDesktopPath } = await import("../agent/rag-engine");
  const context = await getCodebaseContext(config, goal.trim(), executor);
  ragSpinner.success({ text: "Codebase context indexed." });

  const isSystemAccess = process.env.GHOSHCLAW_SYSTEM_ACCESS === "true";
  const homePath = os.homedir();
  const desktopPath = getDesktopPath();

  const systemInstructions = [
    "You are Ghoshclaw, a private, local AI development co-pilot agent.",
    "Always identify yourself as Ghoshclaw.",
    `Workspace root: ${config.codebasePath}`,
    `OS Environment: ${process.platform === 'win32' ? 'Windows (cmd/powershell)' : 'Unix/Linux (sh/bash)'}`,
    `Note: Always use platform-compatible shell commands. On Windows, DO NOT use 'mv', 'rm', or 'cp' in shell executions; use 'move', 'del', or 'copy' (or PowerShell equivalents). Prefer utilizing the structured file tools over shell commands for basic file changes.`,
    "CRITICAL: You must use the tool calling functions to create folders, write files, search files, and execute shell commands. Do not write JSON blocks or code snippets in your text response if you need to execute an action. You MUST call the corresponding tool function instead.",
    `Full System Access: ${isSystemAccess ? 'ENABLED' : 'DISABLED'}`,
    isSystemAccess
      ? `You have FULL access to the user's system outside the workspace sandbox. You can write files or create folders anywhere. The user's Home Directory is: ${homePath} and Desktop is: ${desktopPath}. If the user asks to create files or folders on their Desktop or Home, use these absolute paths.`
      : `You are restricted to the workspace. Do not attempt to access files outside the workspace.`,
    "",
    "Below is the current codebase context retrieved from the user's workspace:",
    context
  ].join("\n");

  for (const step of selected) {
    console.log(chalk.bold(`\n🔧 ${step.title}\n`));

    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(30),
      instructions: systemInstructions,
      tools,
    });

    const r = await agent.generate({
      prompt: stepPrompt(plan.goal, step),
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

    if (r.text) {
      console.log(renderTerminalMarkdown(r.text));
      const { extractAndExecuteTextualToolCall } = await import("../agent/textual-tool-parser");
      extractAndExecuteTextualToolCall(r.text, executor, tracker);
    }

  }

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

  if(!ok) return executor.clearStaging();

   const { errors } = executor.applyApprovedFromTracker();
  if (errors.length) {
    console.log(chalk.red('\nSome operations reported errors:\n'));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
  } else {
    console.log(chalk.green('\n✓ Applied.\n'));
  }
  executor.clearStaging();
}

