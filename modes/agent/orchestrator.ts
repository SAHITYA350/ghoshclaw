import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
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

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: [
      `Workspace root: ${config.codebasePath}`,
      `OS Environment: ${process.platform === 'win32' ? 'Windows (cmd/powershell)' : 'Unix/Linux (sh/bash)'}`,
      `Note: Always use platform-compatible shell commands. On Windows, DO NOT use 'mv', 'rm', or 'cp' in shell executions; use 'move', 'del', or 'copy' (or PowerShell equivalents). Prefer utilizing the structured file tools over shell commands for basic file changes.`,
      "All mutations are staged until approval.",
    ].join("\n"),
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