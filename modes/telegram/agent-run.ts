import { tool, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import os from "node:os";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { createAgentTools } from "../agent/agent-tools.ts";
import { defaultAgentConfig, type AgentConfig } from "../agent/types.ts";
import { createWebTools } from "../plan/web-tools.ts";
import type { Plan, PlanStep } from "../plan/types.ts";
import { replyMd } from "./text.ts";
import { finishOrApprove } from "./approval-session.ts";

function readOnlyConfig(): AgentConfig {
  const c = defaultAgentConfig();
  c.tools.allowFileCreation = false;
  c.tools.allowFileModification = false;
  c.tools.allowFolderCreation = false;
  c.tools.allowShellExecution = false;
  return c;
}

function getSystemPrompt(config: AgentConfig, context?: string) {
  const isSystemAccess = process.env.GHOSHCLAW_SYSTEM_ACCESS === "true";
  const homePath = os.homedir();
  const { getDesktopPath } = require("../agent/rag-engine.ts");
  const desktopPath = getDesktopPath();

  const instructions = [
    "You are Ghoshclaw, a private, local AI development co-pilot agent.",
    "Always identify yourself as Ghoshclaw.",
    `Workspace root: ${config.codebasePath}`,
    `OS Environment: ${process.platform === 'win32' ? 'Windows (cmd/powershell)' : 'Unix/Linux (sh/bash)'}`,
    `Note: Always use platform-compatible shell commands. On Windows, DO NOT use 'mv', 'rm', or 'cp' in shell executions; use 'move', 'del', or 'copy' (or PowerShell equivalents). Prefer utilizing the structured file tools over shell commands for basic file changes.`,
    "CRITICAL: You must use the tool calling functions to create folders, write files, search files, and execute shell commands. Do not write JSON blocks or code snippets in your text response if you need to execute an action. You MUST call the corresponding tool function instead.",
    `Full System Access: ${isSystemAccess ? 'ENABLED' : 'DISABLED'}`,
  ];

  if (isSystemAccess) {
    instructions.push(
      `You have FULL access to the user's system outside the workspace sandbox. You can write files or create folders anywhere. The user's Home Directory is: ${homePath} and Desktop is: ${desktopPath}. If the user asks to create files or folders on their Desktop or Home, use these absolute paths.`
    );
  } else {
    instructions.push(
      `You are restricted to the workspace. Do not attempt to access files outside the workspace.`
    );
  }

  if (context) {
    instructions.push(
      "",
      "Below is the current codebase context retrieved from the user's workspace:",
      context
    );
  }

  return instructions.join("\n");
}

function createReadOnlyTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description: "Read a workspace file (relative path).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),
    list_files: tool({
      description: "List files/dirs at a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),
    search_files: tool({
      description:
        "Find files matching a glob pattern; optional content filter.",
      inputSchema: z.object({
        root: z.string(),
        pattern: z.string(),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),
    analyze_codebase: tool({
      description: "Summarize the codebase structure.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),
  };
}

function extraWebTools(tracker: ActionTracker) {
  return process.env.FIRECRAWL_API_KEY ? createWebTools(tracker) : {};
}


export async function runAsk(ctx:{reply:(t:string , o?:object)=>Promise<unknown>} , question:string){
  const config = readOnlyConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const { getCodebaseContext } = await import("../agent/rag-engine.ts");
  const context = await getCodebaseContext(config, question.trim(), executor);
  const tools = { ...createReadOnlyTools(executor), ...extraWebTools(tracker) };
  
  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(20),
    instructions: getSystemPrompt(config, context),
    tools,
  });

  const result = await agent.generate({ prompt: question });
  await replyMd(ctx , result.text || ("no answer"))
}

export async function runAgent(ctx: { reply: (t: string, o?: object) => Promise<unknown> }, chatId: number, goal: string) {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const { getCodebaseContext } = await import("../agent/rag-engine.ts");
  const context = await getCodebaseContext(config, goal.trim(), executor);
  const tools = createAgentTools(executor);
  
  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: getSystemPrompt(config, context),
    tools,
  });

  const result = await agent.generate({ prompt: goal });
  if (result.text?.trim()) await replyMd(ctx, result.text.trim());
  await finishOrApprove(ctx, chatId, tracker, executor, '✅ Done. No file changes were needed.');
}

export async function runPlanSteps(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  chatId: number,
  plan: Plan,
  steps: PlanStep[],
) {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const { getCodebaseContext } = await import("../agent/rag-engine.ts");
  const context = await getCodebaseContext(config, plan.goal.trim(), executor);
  const tools = { ...createAgentTools(executor), ...extraWebTools(tracker) };

  for (const step of steps) {
    await ctx.reply(`🔧 Executing: *${step.title}*`, { parse_mode: 'Markdown' });
    const prompt = [`Goal: ${plan.goal}`, `Step: ${step.title}`, step.description].join('\n');
    
    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(30),
      instructions: getSystemPrompt(config, context),
      tools,
    });

    const result = await agent.generate({ prompt });
    if (result.text?.trim()) await replyMd(ctx, result.text.trim());
  }

  await finishOrApprove(ctx, chatId, tracker, executor, '✅ All steps done. No file changes needed.');
}
