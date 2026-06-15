import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { text, isCancel, select } from '@clack/prompts';
import { generateText } from 'ai';
import { getAgentModel } from '../../ai/ai.config';
import { loadTimeline } from './timeline-logger';
import { ActionTracker } from './action-tracker';
import { ToolExecutor } from './tool-executor';
import { defaultAgentConfig } from './types';
import { runApprovalFlow } from './approval';

interface RollbackOperation {
  action: 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
}

interface RollbackPlan {
  reasoning: string;
  operations: RollbackOperation[];
}

function cleanJsonString(str: string): string {
  return str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (match, p1) => {
    return `"${p1.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
  });
}

export async function runRollbackMode() {
  console.log(chalk.bold("\n⏮️  Intent-Based Semantic Rollback\n"));

  const timeline = loadTimeline();
  if (timeline.length === 0) {
    console.log(chalk.yellow("⚠️ No history found in the memory timeline to roll back.\n"));
    await text({ message: "Press ENTER to return to CLI menu" });
    return;
  }

  // Show recent timeline entries to help the user
  console.log(chalk.dim("Recent project transactions:"));
  for (let i = Math.max(0, timeline.length - 5); i < timeline.length; i++) {
    const entry = timeline[i]!;
    console.log(`  • ${chalk.yellow(`[Session ${i + 1}]`)} ${entry.goal} (${new Date(entry.timestamp).toLocaleDateString()})`);
  }
  console.log();

  const intent = await text({
    message: "What changes would you like to roll back?",
    placeholder: "e.g., 'revert auth changes but keep UI edits' or 'undo session 2'",
  });

  if (isCancel(intent) || !intent.trim()) return;

  console.log(chalk.cyan("\n🔍 Analyzing timeline and current files for rollback..."));

  // Fetch current contents of files listed in the timeline to inject into LLM
  const fileContents: Record<string, string> = {};
  for (const entry of timeline) {
    for (const c of entry.changes) {
      if (c.type !== 'tool_execute' && !fileContents[c.path]) {
        try {
          const fullPath = path.resolve(process.cwd(), c.path);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            fileContents[c.path] = fs.readFileSync(fullPath, 'utf8');
          }
        } catch (e) {}
      }
    }
  }

  const model = getAgentModel();
  const prompt = `You are a Semantic Rollback Agent. Your task is to selectively revert code modifications based on the user's rollback intent.

User Rollback Intent: "${intent}"

Here is the Living Memory Timeline of the project:
${JSON.stringify(timeline, null, 2)}

Here are the current contents of the relevant files in the workspace:
${JSON.stringify(fileContents, null, 2)}

Identify which history events and specific code edits match the user's rollback intent.
For the matching edits, calculate the rolled-back contents of the files. If subsequent edits exist on the same files, selectively revert ONLY the changes related to the rollback intent while leaving other modifications intact.
If the matched change was a file creation, the rollback action is "delete".
If the matched change was a file deletion, the rollback action is "create" and you should restore the content prior to the delete.

Output your plan as a JSON object containing:
1. "reasoning": A 1-2 sentence explanation of which timeline sessions were matched and why.
2. "operations": An array of:
   - "action": "create" | "modify" | "delete"
   - "path": Relative path of the file
   - "content": Complete rolled-back file content (only for "create" or "modify")

Return ONLY the raw JSON block. Do not include markdown formatting or explanations outside the JSON block.`;

  try {
    const response = await generateText({
      model,
      prompt,
    });

    const rawOutput = response.text?.trim() || "";
    const cleanOutput = rawOutput.replace(/```json|```/g, "").trim();
    
    let plan: RollbackPlan;
    try {
      plan = JSON.parse(cleanJsonString(cleanOutput));
    } catch (e: any) {
      console.log(chalk.red(`\n⚠️ Failed to parse rollback plan: ${e.message}`));
      console.log(chalk.dim(`Raw Output: ${rawOutput}`));
      await text({ message: "Press ENTER to return to CLI menu" });
      return;
    }

    console.log(chalk.bold("\n📋 Proposed Rollback Plan:"));
    console.log(`  Reasoning: ${chalk.cyan(plan.reasoning)}\n`);

    if (!plan.operations || plan.operations.length === 0) {
      console.log(chalk.yellow("  No operations matched this rollback intent.\n"));
      await text({ message: "Press ENTER to return to CLI menu" });
      return;
    }

    // Stage the rollback operations in the ActionTracker
    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);

    for (const op of plan.operations) {
      if (op.action === 'create') {
        executor.createFile(op.path, op.content || '');
      } else if (op.action === 'modify') {
        executor.modifyFile(op.path, op.content || '');
      } else if (op.action === 'delete') {
        executor.deleteFile(op.path);
      }
    }

    const ok = await runApprovalFlow(tracker);
    if (!ok) {
      executor.clearStaging();
      console.log(chalk.yellow("\nRollback cancelled.\n"));
      await text({ message: "Press ENTER to return to CLI menu" });
      return;
    }

    const { errors } = executor.applyApprovedFromTracker();
    if (errors.length) {
      console.log(chalk.red("\nSome operations reported errors:\n"));
      for (const e of errors) console.log(chalk.red(`  • ${e}`));
    } else {
      console.log(chalk.green('\n✓ Rollback changes successfully applied.\n'));
    }
    executor.clearStaging();

  } catch (e: any) {
    console.log(chalk.red(`\nError during rollback analysis: ${e.message}\n`));
  }

  await text({ message: "Press ENTER to return to CLI menu" });
}
