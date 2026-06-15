import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { generateText } from 'ai';
import { getAgentModel } from '../../ai/ai.config';
import type { ActionLog } from './types';
import { composeBeforeAfter, formatPatch } from './diff-view';

export async function generateReasoningAndMetadata(
  goal: string,
  changesDescription: string
): Promise<{ reasoning: string; confidence: number; risk: string }> {
  try {
    const model = getAgentModel();
    const prompt = `You are an AI Software Architect. Based on the user's goal: "${goal}" and these changes:\n${changesDescription}\n
Provide a JSON object containing:
1. "reasoning": a concise 1-sentence explanation of what this change accomplishes and why it was done.
2. "confidence": an integer between 1 and 100 representing your confidence in this solution.
3. "risk": "Low", "Medium", or "High" estimating regression risk.

Return ONLY the JSON object. Do not include any markdown format or surrounding text.`;

    const result = await generateText({
      model,
      prompt,
    });
    
    const text = result.text?.trim() || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      reasoning: parsed.reasoning || "Applied changes.",
      confidence: parsed.confidence || 90,
      risk: parsed.risk || "Low"
    };
  } catch (e) {
    return {
      reasoning: `Executed: ${goal}`,
      confidence: 95,
      risk: "Low"
    };
  }
}


export interface TimelineChange {
  path: string;
  type: string;
  patch?: string;
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  goal: string;
  reasoning?: string;
  status: 'approved' | 'rejected';
  changes: TimelineChange[];
  confidence?: number;
  risk?: string;
}

const TIMELINE_PATH = path.resolve(process.cwd(), 'modes/agent/memory-timeline.json');

export function loadTimeline(): TimelineEntry[] {
  try {
    if (fs.existsSync(TIMELINE_PATH)) {
      const data = fs.readFileSync(TIMELINE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading timeline:', e);
  }
  return [];
}

export function saveTimeline(entries: TimelineEntry[]): void {
  try {
    const dir = path.dirname(TIMELINE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TIMELINE_PATH, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving timeline:', e);
  }
}

export function logSession(
  goal: string,
  reasoning: string,
  pendingActions: ActionLog[],
  status: 'approved' | 'rejected',
  extra?: { confidence?: number; risk?: string }
): void {
  const entries = loadTimeline();
  
  const changes: TimelineChange[] = [];
  const byPath = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pendingActions) {
    if (a.type === 'tool_execute') {
      shells.push(a);
      continue;
    }
    const key = a.path;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(a);
  }

  for (const [p, acts] of byPath.entries()) {
    const sorted = acts.sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    const last = sorted[sorted.length - 1]!;
    
    let patch: string | undefined;
    if (last.type !== 'folder_create') {
      const { before, after } = composeBeforeAfter(sorted);
      patch = formatPatch(p, before, after);
    }
    
    changes.push({
      path: p,
      type: last.type,
      patch
    });
  }

  for (const s of shells) {
    changes.push({
      path: s.details.command ?? 'shell',
      type: 'tool_execute'
    });
  }

  const newEntry: TimelineEntry = {
    id: `session_${Date.now()}`,
    timestamp: new Date().toISOString(),
    goal,
    reasoning,
    status,
    changes,
    ...extra
  };

  entries.push(newEntry);
  saveTimeline(entries);
}

export function renderTimeline(): string {
  const entries = loadTimeline();
  if (entries.length === 0) {
    return chalk.dim('\nMemory timeline is currently empty.\n');
  }

  let out = '\n' + chalk.bold.cyan('📜 LIVING MEMORY TIMELINE') + '\n';
  out += chalk.gray('────────────────────────────────────────────────────────────\n');

  // Group by date
  const groups: Record<string, TimelineEntry[]> = {};
  for (const entry of entries) {
    const dateStr = new Date(entry.timestamp).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(entry);
  }

  for (const [date, sessions] of Object.entries(groups)) {
    out += `\n${chalk.bold.yellow(date)}\n`;
    for (const s of sessions) {
      const statusColor = s.status === 'approved' ? chalk.green : chalk.red;
      const confTag = s.confidence ? ` (Confidence: ${s.confidence}%)` : '';
      const riskTag = s.risk ? ` [Risk: ${s.risk}]` : '';
      
      out += `├─ ${statusColor(`[${s.status.toUpperCase()}]`)} ${chalk.white(s.goal)}${chalk.dim(confTag + riskTag)}\n`;
      if (s.reasoning) {
        out += `│  └─ ${chalk.gray('Why:')} ${chalk.italic(s.reasoning)}\n`;
      }
      for (let i = 0; i < s.changes.length; i++) {
        const c = s.changes[i]!;
        const isLast = i === s.changes.length - 1;
        const icon = c.type === 'file_create' ? '➕' : c.type === 'file_modify' ? '📝' : c.type === 'file_delete' ? '❌' : '🖥';
        out += `│     ${isLast ? '└─' : '├─'} ${icon} ${chalk.cyan(c.path)} (${chalk.dim(c.type.replace('_', ' '))})\n`;
      }
    }
  }
  return out;
}
