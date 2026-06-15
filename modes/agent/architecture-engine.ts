import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { text } from '@clack/prompts';
import { generateText } from 'ai';
import { getAgentModel } from '../../ai/ai.config';

interface CategoryScores {
  codeStructure: number;
  dependencies: number;
  testCoverage: number;
  security: number;
  documentation: number;
}

interface HeatmapItem {
  module: string;
  score: number;
}

interface RoadmapItem {
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  description: string;
}

interface ArchitectureReport {
  maturityScore: number;
  categories: CategoryScores;
  heatmap: HeatmapItem[];
  roadmap: RoadmapItem[];
}

function getProgressBar(score: number, width = 10): string {
  const filledCount = Math.round((score / 100) * width);
  const emptyCount = width - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

export async function runArchitectureEngine() {
  console.log(chalk.bold("\n🏛️  Architecture Evolution Engine\n"));
  console.log(chalk.cyan("🔍 Analyzing repository structure, packages, and code metrics..."));

  // 1. Gather repository statistics
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  const fileList: string[] = [];
  let packageJsonContent = "";

  const walk = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const fullPath = path.join(dir, ent.name);
        const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        
        // Exclude common build/temp folders
        if (
          ent.name === 'node_modules' ||
          ent.name === '.git' ||
          ent.name === 'dist' ||
          ent.name === 'build' ||
          ent.name === '.next'
        ) {
          continue;
        }

        if (ent.isDirectory()) {
          dirCount++;
          walk(fullPath);
        } else {
          fileCount++;
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
          fileList.push(relPath);
          
          if (ent.name === 'package.json') {
            packageJsonContent = fs.readFileSync(fullPath, 'utf8');
          }
        }
      }
    } catch (e) {}
  };
  
  walk(process.cwd());

  const model = getAgentModel();
  const prompt = `You are a Principal Software Architect. Analyze this codebase statistics to evaluate its design maturity and architecture health.

Files counted: ${fileCount}
Directories counted: ${dirCount}
Total codebase size: ${Math.round(totalBytes / 1024)} KB
All codebase files:
${JSON.stringify(fileList, null, 2)}

package.json:
${packageJsonContent || "(not found)"}

Generate an Architecture Maturity and Evolution Report.
Output a JSON object containing:
1. "maturityScore": integer (1-100) representing overall maturity
2. "categories": An object with integer scores (1-100) for:
   - "codeStructure"
   - "dependencies"
   - "testCoverage"
   - "security"
   - "documentation"
3. "heatmap": An array of objects containing "module" (e.g., "modes/agent", "tui", "ai", "root") and "score" (1-100)
4. "roadmap": An array of 4-5 items containing:
   - "title": Short title of action (e.g., "Extract Event Bus")
   - "priority": "High" | "Medium" | "Low"
   - "description": 1-sentence description.

Return ONLY the raw JSON block. Do not include markdown wraps or explanation outside the JSON.`;

  try {
    const response = await generateText({
      model,
      prompt,
    });

    const rawOutput = response.text?.trim() || "";
    const cleanOutput = rawOutput.replace(/```json|```/g, "").trim();
    
    let report: ArchitectureReport;
    try {
      report = JSON.parse(cleanOutput);
    } catch (e: any) {
      console.log(chalk.red(`\n⚠️ Failed to parse architecture assessment: ${e.message}`));
      console.log(chalk.dim(`Raw Output: ${rawOutput}`));
      await text({ message: "Press ENTER to return to CLI menu" });
      return;
    }

    console.clear();
    console.log(chalk.bold.cyan("\n🏛️  ARCHITECTURE EVOLUTION REPORT"));
    console.log(chalk.gray("────────────────────────────────────────────────────────────"));
    console.log(`Overall Maturity: ${chalk.bold.yellow(report.maturityScore + "%")}   [ ${getProgressBar(report.maturityScore, 20)} ]`);
    console.log(chalk.gray("────────────────────────────────────────────────────────────"));
    
    console.log(chalk.bold("\nMaturity Breakdown:"));
    const cats = report.categories;
    console.log(`  Code Structure:   ${getProgressBar(cats.codeStructure)}  ${cats.codeStructure}%`);
    console.log(`  Dependencies:     ${getProgressBar(cats.dependencies)}  ${cats.dependencies}%`);
    console.log(`  Test Coverage:    ${getProgressBar(cats.testCoverage)}  ${cats.testCoverage}%`);
    console.log(`  Security Scan:    ${getProgressBar(cats.security)}  ${cats.security}%`);
    console.log(`  Documentation:    ${getProgressBar(cats.documentation)}  ${cats.documentation}%`);

    console.log(chalk.bold("\nModule Health Heatmap:"));
    for (const h of report.heatmap) {
      const color = h.score >= 80 ? chalk.green : h.score >= 50 ? chalk.yellow : chalk.red;
      console.log(`  • ${h.module.padEnd(20)}: [ ${color(getProgressBar(h.score))} ] ${h.score}%`);
    }

    console.log(chalk.bold("\nNext Roadmap Recommendations:"));
    for (let i = 0; i < report.roadmap.length; i++) {
      const item = report.roadmap[i]!;
      const prioColor = item.priority === 'High' ? chalk.red : item.priority === 'Medium' ? chalk.yellow : chalk.green;
      console.log(`  ${i + 1}. ${chalk.bold(item.title)} [${prioColor(item.priority)}]`);
      console.log(`     ${chalk.dim(item.description)}`);
    }

    console.log(chalk.gray("\n────────────────────────────────────────────────────────────"));
    console.log();

  } catch (e: any) {
    console.log(chalk.red(`\nError generating report: ${e.message}\n`));
  }

  await text({ message: "Press ENTER to return to CLI menu" });
}
