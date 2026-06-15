import { StateGraph, START, END } from "@langchain/langgraph";
import chalk from "chalk";
import { getGroqClient } from "../../ai/groq.config";
import { RAGEngine } from "./rag-engine";
import { ToolExecutor } from "./tool-executor";
import { ActionTracker } from "./action-tracker";
import { defaultAgentConfig } from "./types";
import { runApprovalFlow } from "./approval";
import { logSession } from "./timeline-logger";

export interface AgentState {
  task: string;
  ragContext: string[];
  proposal: string;
  critique: string;
  riskAssessment: string;
  codeChanges: string;
  confidenceScore: number;
  riskLevel: string;
  expectedBenefit: string;
  reasoning: string;
  attempts: number;
  status: string;
}

function cleanJsonString(str: string): string {
  return str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (match, p1) => {
    return `"${p1.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
  });
}

function parseCleanJson(rawText: string): any {
  let jsonText = rawText.trim();
  
  // Try to find markdown code block first
  const markdownMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
  if (markdownMatch) {
    jsonText = markdownMatch[1]!.trim();
  } else {
    // Fallback: extract from the first '{' to the last '}'
    const braceStart = jsonText.indexOf('{');
    const braceEnd = jsonText.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      jsonText = jsonText.slice(braceStart, braceEnd + 1);
    }
  }

  const cleanJson = cleanJsonString(jsonText);
  return JSON.parse(cleanJson);
}


export class GhoshclawAgentGraph {
  private rag = new RAGEngine();
  private tracker = new ActionTracker();
  private executor = new ToolExecutor(this.tracker, defaultAgentConfig());

  constructor() {}

  async run(task: string, workspacePath: string): Promise<string> {
    await this.rag.indexCodebase(workspacePath);

    const workflow = new StateGraph<AgentState>({
      channels: {
        task: null,
        ragContext: null,
        proposal: null,
        critique: null,
        riskAssessment: null,
        codeChanges: null,
        confidenceScore: null,
        riskLevel: null,
        expectedBenefit: null,
        reasoning: null,
        attempts: null,
        status: null,
      }
    })
      .addNode("research", async (state) => {
        console.log(chalk.cyan("  🔍 [Research Agent] Retrieving workspace context & RAG chunks..."));
        let globalContext = "";

        try {
          const fileTree = this.executor.listFiles(".", true);
          globalContext += `### Project File Structure:\n\`\`\`\n${fileTree}\n\`\`\`\n\n`;
        } catch (e) {}

        try {
          const pkgJson = this.executor.readFile("package.json");
          globalContext += `### Project package.json (Dependencies):\n\`\`\`json\n${pkgJson}\n\`\`\`\n\n`;
        } catch (e) {}

        const semanticSnippets = this.rag.retrieve(state.task, 5);
        if (semanticSnippets.length > 0) {
          globalContext += `### Relevant Code Snippets:\n${semanticSnippets.join("\n\n")}`;
        }

        return { ragContext: [globalContext] };
      })
      .addNode("proposer", async (state) => {
        console.log(chalk.blue("  💡 [Proposer Agent] Drafting implementation plan & code changes..."));
        const groq = getGroqClient();
        const modelId = process.env.GROQ_DEFAULT_MODEL || "llama-3.3-70b-versatile";

        const prompt = `You are the Proposer Agent. Your goal is to propose code changes to achieve: "${state.task}".
Here is the codebase context:\n${state.ragContext.join("\n\n")}

Propose the exact files you want to create, modify, or delete, and describe the code changes clearly.
Keep your proposal focused on the task and do not create plans or files unrelated to the task.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: modelId,
        });

        return { proposal: response.choices[0]?.message?.content || "" };
      })
      .addNode("critic", async (state) => {
        console.log(chalk.magenta("  🕵️  [Critic Agent] Auditing proposed code for quality and edge cases..."));
        const groq = getGroqClient();
        const modelId = process.env.GROQ_DEFAULT_MODEL || "llama-3.3-70b-versatile";

        const prompt = `You are the Critic Agent. Analyze the following proposed implementation plan from the Proposer Agent for bugs, type safety violations, security vulnerabilities, unhandled exceptions, or performance regressions:

Goal: "${state.task}"
Proposed Implementation:
${state.proposal}

List any issues, warnings, or improvements. Be critical and specific.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: modelId,
        });

        return { critique: response.choices[0]?.message?.content || "" };
      })
      .addNode("risk_estimator", async (state) => {
        console.log(chalk.yellow("  ⚖️  [Risk Estimator] Rating regression risk levels and confidence..."));
        const groq = getGroqClient();
        const modelId = process.env.GROQ_DEFAULT_MODEL || "llama-3.3-70b-versatile";

        const prompt = `You are the Risk Estimator Agent. Assess the regression risks and confidence of this proposal and its critique.
Proposal:
${state.proposal}

Critique:
${state.critique}

Provide a JSON object containing:
1. "riskLevel": "Low", "Medium", or "High"
2. "confidenceScore": integer between 1 and 100
3. "expectedBenefit": a short sentence describing the expected benefit.

Return ONLY the raw JSON block. Do not include markdown wraps.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: modelId,
        });

        const text = (response.choices[0]?.message?.content || "").trim();
        const clean = text.replace(/```json|```/g, "").trim();
        let riskLevel = "Low";
        let confidenceScore = 90;
        let expectedBenefit = "Code improvements";
        try {
          const parsed = JSON.parse(clean);
          riskLevel = parsed.riskLevel || "Low";
          confidenceScore = parsed.confidenceScore || 90;
          expectedBenefit = parsed.expectedBenefit || "Code improvements";
        } catch (e) {}

        return { riskLevel, confidenceScore, expectedBenefit, riskAssessment: text };
      })
      .addNode("orchestrator", async (state) => {
        console.log(chalk.green("  🎯 [Orchestrator Agent] Synthesizing debate and generating final action plan..."));
        const groq = getGroqClient();
        const modelId = process.env.GROQ_DEFAULT_MODEL || "llama-3.3-70b-versatile";

        const prompt = `You are the Orchestrator Agent. Consolidate the debate components below into a final, robust action list. Fix any critique issues.

Goal: "${state.task}"
Proposed Plan:
${state.proposal}
Critic Critique:
${state.critique}
Risk Assessment:
${state.riskAssessment}

You must output a JSON array of file operations to perform.
Each operation should have:
- "action": "create", "modify", or "delete"
- "path": relative path to the file
- "content": the complete file content to write (only for "create" or "modify")

If you need to rename a file, generate two operations:
1. "create" for the new file path with the content.
2. "delete" for the old file path.

CRITICAL SAFETY RULES:
1. Only delete files if the user's goal explicitly requests a deletion or a rename. DO NOT delete existing files (like blob.md, explain.md, etc.) unless the goal: "${state.task}" explicitly requires it.
2. If the user wants to write/add content inside a file (e.g. "write inside blob.md"), you should "modify" or "create" that file. DO NOT delete it!
3. If the user goal is just to write content (like a poem or text), DO NOT generate "implementation_plan.md" or write technical code files unless requested. Keep the output focused solely on the user's requested text or code.

Also output a single "reasoning" string describing the final consensus logic in 1 sentence.

Format your output exactly as a JSON object:
{
  "reasoning": "A single sentence explaining why this change was chosen.",
  "operations": [
    {
      "action": "create" | "modify" | "delete",
      "path": "file.ts",
      "content": "..."
    }
  ]
}

Return ONLY the raw JSON block. Do not write explanations outside the JSON block.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: modelId,
        });

        const codeChanges = response.choices[0]?.message?.content || "";
        let reasoning = "Consolidated implementation changes.";

        try {
          const parsed = parseCleanJson(codeChanges);
          reasoning = parsed.reasoning || reasoning;
          const ops = parsed.operations || [];

          for (const op of ops) {
            if (op.action === "create") {
              this.executor.createFile(op.path, op.content);
              console.log(chalk.green(`  ➕ Staged file creation: ${op.path}`));
            } else if (op.action === "modify") {
              this.executor.modifyFile(op.path, op.content);
              console.log(chalk.green(`  📝 Staged file modification: ${op.path}`));
            } else if (op.action === "delete") {
              this.executor.deleteFile(op.path);
              console.log(chalk.red(`  ❌ Staged file deletion: ${op.path}`));
            }
          }
        } catch (e: any) {
          console.log(chalk.red(`  ⚠️ Failed to parse orchestrator operations JSON: ${e.message}`));
        }


        return { codeChanges, reasoning };
      });

    workflow
      .addEdge(START, "research")
      .addEdge("research", "proposer")
      .addEdge("proposer", "critic")
      .addEdge("critic", "risk_estimator")
      .addEdge("risk_estimator", "orchestrator")
      .addEdge("orchestrator", END);

    const graph = workflow.compile();

    console.log("🚀 Starting LangGraph Multi-Agent Workflows...");
    const finalState = await graph.invoke({
      task,
      attempts: 0,
      status: "started",
      ragContext: [],
      proposal: "",
      critique: "",
      riskAssessment: "",
      codeChanges: "",
      confidenceScore: 0,
      riskLevel: "",
      expectedBenefit: "",
      reasoning: "",
    });

    console.log("✨ LangGraph multi-agent loop finished.");
    console.log(chalk.bold(`\n📊 DEBATE ASSESSMENT REPORT:`));
    console.log(`  Confidence Score: ${chalk.green(finalState.confidenceScore + "%")}`);
    console.log(`  Risk Level:       ${finalState.riskLevel === "Low" ? chalk.green(finalState.riskLevel) : finalState.riskLevel === "Medium" ? chalk.yellow(finalState.riskLevel) : chalk.red(finalState.riskLevel)}`);
    console.log(`  Expected Benefit: ${chalk.cyan(finalState.expectedBenefit)}`);
    console.log(`  Orchestrator:     ${chalk.italic(finalState.reasoning)}\n`);

    const ok = await runApprovalFlow(this.tracker);
    
    // Log to Memory Timeline
    const pending = this.tracker.getPendingMutations();
    if (pending.length > 0) {
      logSession(task, finalState.reasoning, pending, ok ? "approved" : "rejected", {
        confidence: finalState.confidenceScore,
        risk: finalState.riskLevel,
      });
    }

    if (!ok) {
      this.executor.clearStaging();
      return "Staged changes rejected by user.";
    }

    const { errors } = this.executor.applyApprovedFromTracker();
    if (errors.length) {
      const errList = errors.map((e) => `• ${e}`).join("\n");
      this.executor.clearStaging();
      throw new Error(`Failed to apply changes:\n${errList}`);
    }

    this.executor.clearStaging();
    return "Staged changes successfully applied to workspace!";
  }
}
