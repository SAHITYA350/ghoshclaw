import chalk from "chalk";
import { select, isCancel, text } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runAskMode } from "./ask/orchestrator";
import { runPlanMode } from "./plan/orchestrator";
import { GhoshclawAgentGraph } from "./agent/graph";
import { renderTerminalMarkdown } from "../tui/terminal-md";
import { renderTimeline } from "./agent/timeline-logger";
import { runGuardian } from "./agent/guardian";
import { runRollbackMode } from "./agent/rollback";
import { runArchitectureEngine } from "./agent/architecture-engine";

async function runGoatMode() {
  console.log(chalk.bold("\n🧠 Ghoshclaw 2027 (Langchain + Rag) Mode\n"));
  const goal = await text({
    message: "What is your goal?",
    placeholder: "Concrete task to run with LangChain multi-agent debate...",
  });

  if (isCancel(goal) || !goal.trim()) return;

  const graph = new GhoshclawAgentGraph();
  try {
    const result = await graph.run(goal.trim(), ".");
    console.log(chalk.bold("\n✨ Proposed Solution:\n"));
    console.log(renderTerminalMarkdown(result));
    
    // Hold screen so the user can read the output
    await text({ message: "Press ENTER to return to CLI menu" });
  } catch (e: any) {
    console.log(chalk.red(`\nError running LangChain: ${e.message}\n`));
    await text({ message: "Press ENTER to return to CLI menu" });
  }
}

async function showTimeline() {
  console.log(renderTimeline());
  await text({ message: "Press ENTER to return to CLI menu" });
}

export async function runCliMode() {
  while (true) {
    process.stdin.resume();
    const mode = await select({
      message: "Choose CLI sub-mode",
      options: [
        { value: "agent", label: "Agent-Mode" },
        { value: "plan", label: "Plan-Mode" },
        { value: "ask", label: "Ask-Mode" },
        { value: "goat", label: "🧠 Multi-Agent" },
        { value: "timeline", label: "📜 Memory-Timeline" },
        { value: "guardian", label: "🛡️  Background-Guardian" },
        { value: "rollback", label: "⏮️  Semantic-Rollback" },
        { value: "architect", label: "🏛️  Architecture-Engine" },
        { value: "back", label: "⬅️  Back to main menu" },
      ],
    });

    if (isCancel(mode) || mode === "back") return;

    if (mode === "agent") {
      await runAgentMode();
    }
    else if (mode === "ask") {
      await runAskMode();
    }
    else if (mode === "plan") {
      await runPlanMode();
    }
    else if (mode === "goat") {
      await runGoatMode();
    }
    else if (mode === "timeline") {
      await showTimeline();
    }
    else if (mode === "guardian") {
      await runGuardian();
    }
    else if (mode === "rollback") {
      await runRollbackMode();
    }
    else if (mode === "architect") {
      await runArchitectureEngine();
    }
  }
}