import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import os from "node:os";
import { stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { runApprovalFlow } from "../agent/approval.ts";
import { createWebTools } from "../plan/web-tools.ts";
import { RAGEngine } from "../agent/rag-engine.ts";
import { createSpinner } from "nanospinner";

function createAskTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}

function asMd(question: string, answer: string): string {
  return `# Ask Mode\n\n## Question\n\n${question.trim()}\n\n## Answer\n\n${answer.trim()}\n`;
}

export async function runAskMode() {
  console.log(chalk.bold("\n❓ Ask Mode\n"));

  const question = await text({ message: "What do you want to ask?" });
  if (isCancel(question) || !question.trim()) return;

  const config = defaultAgentConfig();
  config.tools.allowFileCreation = true;
  config.tools.allowFileModification = false;
  config.tools.allowFolderCreation = false;
  config.tools.allowShellExecution = false;

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const ragSpinner = createSpinner("Scanning & indexing codebase context...").start();
  const rag = new RAGEngine();
  await rag.indexCodebase(config.codebasePath);
  const semanticSnippets = rag.retrieve(question.trim(), 8);
  ragSpinner.success({ text: "Codebase context indexed." });

  const isSystemAccess = process.env.GHOSHCLAW_SYSTEM_ACCESS === "true";
  const { getDesktopPath } = await import("../agent/rag-engine.ts");
  const homePath = os.homedir();
  const desktopPath = getDesktopPath();

  const systemPrompt = [
    "You are Ghoshclaw, a private, local AI development co-pilot agent.",
    "Always identify yourself as Ghoshclaw.",
    "Your goal is to answer the user's questions about their codebase and development tasks.",
    "Be direct, concise, and helpful.",
    `Workspace root: ${config.codebasePath}`,
    `OS Environment: ${process.platform === 'win32' ? 'Windows (cmd/powershell)' : 'Unix/Linux (sh/bash)'}`,
    `Full System Access: ${isSystemAccess ? 'ENABLED' : 'DISABLED'}`,
    isSystemAccess
      ? `You have FULL access to the user's system outside the workspace sandbox. The user's Home Directory is: ${homePath} and Desktop is: ${desktopPath}. If the user asks about files/folders on their Desktop/Home or wants to perform system tasks, use these paths.`
      : `You are restricted to the workspace sandbox.`,
    "",
    "Here is the context retrieved from the user's local codebase:",
    "--------------------------------------------------",
    semanticSnippets.join("\n\n"),
    "--------------------------------------------------",
    "",
    "Use the tools provided (read_file, search_files, list_files, analyze_codebase, etc.) if you need to gather additional details to answer the user's question accurately."
  ].join("\n");

  const tools = {
    ...createAskTools(executor),
    ...createWebTools(tracker)
  };

  const generateSpinner = createSpinner("Ghoshclaw is thinking...").start();

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(20),
    instructions: systemPrompt,
    tools,
  });

  const result = await agent.generate({ prompt: question.trim() });
  
  generateSpinner.success({ text: "Answer ready." });

  const answer = result.text?.trim() || "(no answer)";
  console.log("\n" + renderTerminalMarkdown(answer) + "\n");

  const wantsSave = await confirm({
    message:"Save this answer to a .md file in the current directory?",
    initialValue:false,
  });
  if (isCancel(wantsSave) || !wantsSave) return;

  const filename = await text({
    message:"Filename",
    initialValue:"ask.md",
     validate: (v) => {
      const s = (v ?? '').trim();
      if (!s) return 'Required';
      if (s.includes('..') || s.includes('/') || s.includes('\\')) return 'No paths';
      if (!s.toLowerCase().endsWith('.md')) return 'Must end with .md';
    },
  })

  if(isCancel(filename)) return;

  executor.createFile(filename , asMd(question , answer));
  const ok = await runApprovalFlow(tracker);
  if(!ok) return executor.clearStaging();

  executor.applyApprovedFromTracker();
  executor.clearStaging();
}
