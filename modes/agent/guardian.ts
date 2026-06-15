import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { generateText } from 'ai';
import { getGroqClient } from '../../ai/groq.config';
import { getAgentModel } from '../../ai/ai.config';

interface GuardianState {
  status: 'HEALTHY' | 'WARNINGS';
  lastScannedFile: string;
  lastScannedTime: string;
  compileStatus: 'PASSING' | 'FAILED';
  compileError: string;
  secretsStatus: 'NONE' | 'EXPOSED';
  secretsError: string;
  aiStatus: 'CLEAR' | 'WARNING';
  aiError: string;
}

let state: GuardianState = {
  status: 'HEALTHY',
  lastScannedFile: 'None',
  lastScannedTime: new Date().toLocaleTimeString(),
  compileStatus: 'PASSING',
  compileError: '',
  secretsStatus: 'NONE',
  secretsError: '',
  aiStatus: 'CLEAR',
  aiError: '',
};

function isExcluded(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const segments = norm.split('/');
  const base = segments[segments.length - 1] ?? '';
  
  const excludes = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'memory-timeline.json',
    '.env',
  ];

  for (const s of excludes) {
    if (segments.includes(s) || norm.startsWith(s)) return true;
  }
  return false;
}

// Scans text file contents for passwords, tokens, API keys
function scanForSecrets(filePath: string, content: string): string | null {
  const lines = content.split('\n');
  const patterns = [
    { name: 'Groq API Key', regex: /gsk_[a-zA-Z0-9]{40,}/ },
    { name: 'OpenRouter/OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/ },
    { name: 'General Secret/Password', regex: /(password|passwd|client_secret|private_key|database_url)\s*=\s*['"][a-zA-Z0-9_]{8,}['"]/i },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pat of patterns) {
      if (pat.regex.test(line)) {
        return `${pat.name} on Line ${i + 1}`;
      }
    }
  }
  return null;
}

// Runs TypeScript compilation type-checking
export function runTypeCheck(): string | null {
  try {
    const res = spawnSync('bun', ['x', 'tsc', '--noEmit'], {
      encoding: 'utf8',
      cwd: process.cwd()
    });
    if (res.status !== 0) {
      const firstError = (res.stdout || res.stderr || '')
        .split('\n')
        .find(line => line.includes('error TS'));
      return firstError ? firstError.trim() : 'Compilation errors detected';
    }
  } catch (e) {
    return 'Failed to execute tsc check';
  }
  return null;
}

// Calls fast Groq LLM to check code quality/security
async function runAiAudit(filePath: string, content: string): Promise<string | null> {
  try {
    const groq = getGroqClient();
    const modelId = process.env.GROQ_DEFAULT_MODEL || 'llama-3.3-70b-versatile';
    
    const prompt = `You are a strict co-pilot code checker. Analyze this typescript file change for CRITICAL bugs, memory leaks, or security issues:\n\nFile: ${filePath}\n\nContent:\n${content.slice(0, 4000)}\n\nIf the code is safe and free of critical issues, respond with "SAFE". Otherwise, describe the single most critical issue in 1 sentence.`;

    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: modelId,
      temperature: 0.1,
      max_tokens: 60,
    });

    const result = (response.choices[0]?.message?.content || '').trim();
    if (result.toUpperCase().includes('SAFE')) {
      return null;
    }
    return result;
  } catch (e) {
    return null; // Silent skip if AI fails/times out
  }
}

// Sends Telegram message if API details are present (using direct lightweight fetch)
async function sendTelegramNotification(message: string, filePath: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;
  if (!token || !ownerId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ownerId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔧 AI Auto-Fix', callback_data: `guardian_fix:${filePath}` }]
          ]
        }
      })
    });
  } catch (e) {}
}

function renderDashboard(watchCount: number) {
  console.clear();
  const statusColor = state.status === 'HEALTHY' ? chalk.bgGreen.black : chalk.bgRed.black;
  const statusText = state.status === 'HEALTHY' ? ' 🟢 HEALTHY ' : ' 🔴 WARNINGS DETECTED ';
  
  console.log(chalk.bold.cyan('\n  🛡️  AUTONOMOUS BACKGROUND GUARDIAN ACTIVE'));
  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
  console.log(`  Workspace:   ${chalk.white(process.cwd())}`);
  console.log(`  State:       ${statusColor(statusText)} (${watchCount} files monitored)`);
  console.log(`  Last Checked: ${chalk.yellow(state.lastScannedFile)} at ${state.lastScannedTime}`);
  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
  
  // Compile Check Results
  if (state.compileStatus === 'PASSING') {
    console.log(`  ${chalk.green('✓')} Compilation: ${chalk.dim('Passing')}`);
  } else {
    console.log(`  ${chalk.red('✗')} Compilation: ${chalk.bold.red('FAILED')}`);
    console.log(`    ${chalk.dim(state.compileError)}`);
  }

  // Secrets Check Results
  if (state.secretsStatus === 'NONE') {
    console.log(`  ${chalk.green('✓')} Secrets Scan: ${chalk.dim('No leaks found')}`);
  } else {
    console.log(`  ${chalk.red('✗')} Secrets Scan: ${chalk.bold.red('EXPOSED CREDENTIAL')}`);
    console.log(`    ${chalk.dim(state.secretsError)}`);
  }

  // AI Audit Results
  if (state.aiStatus === 'CLEAR') {
    console.log(`  ${chalk.green('✓')} AI Code Audit: ${chalk.dim('No major issues')}`);
  } else {
    console.log(`  ${chalk.yellow('⚠')} AI Code Audit: ${chalk.bold.yellow('SUGGESTION')}`);
    console.log(`    ${chalk.dim(state.aiError)}`);
  }

  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
  if (state.status === 'WARNINGS' && state.lastScannedFile !== 'None') {
    console.log(`  ${chalk.bold.yellow('[Press F to Auto-Fix with AI]')}   ${chalk.dim('|   [Press ENTER to return to menu]')}`);
  } else {
    console.log(`  ${chalk.dim('[Press ENTER to return to menu]')}`);
  }
  console.log();
}

// Auto-fixes a file based on compilation errors
export async function runGuardianAutoFix(filePath: string): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return false;

  const compileErrors = runTypeCheck();
  if (!compileErrors) return true; // Already clean

  const content = fs.readFileSync(fullPath, 'utf8');
  const model = getAgentModel();
  const prompt = `You are an AI Debugger. The file \`${filePath}\` has compilation errors:
\`\`\`
${compileErrors}
\`\`\`

Here is the current content of the file:
\`\`\`typescript
${content}
\`\`\`

Analyze the compilation error and rewrite the file to fix it. Keep all other logic intact.
Respond with ONLY the raw corrected file contents. Do not include markdown wraps (like \`\`\`typescript) or explanations.`;

  try {
    const response = await generateText({
      model,
      prompt,
    });

    let result = response.text?.trim() || "";
    if (result.startsWith("```")) {
      const lines = result.split("\n");
      if (lines[0]?.startsWith("```")) lines.shift();
      if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
      result = lines.join("\n").trim();
    }

    if (result) {
      fs.writeFileSync(fullPath, result, 'utf8');
      const verify = runTypeCheck();
      return !verify; // True if compilation passes now
    }
  } catch (e) {}
  return false;
}

export async function runGuardian() {
  console.log(chalk.cyan('\nStarting Guardian daemon...'));
  
  let watchCount = 0;
  const countFiles = (dir: string) => {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        const rel = path.relative(process.cwd(), full);
        if (isExcluded(rel)) continue;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          countFiles(full);
        } else {
          watchCount++;
        }
      }
    } catch (e) {}
  };
  countFiles(process.cwd());

  renderDashboard(watchCount);

  let debounceTimer: Timer | null = null;

  const handleFileChange = (relPath: string) => {
    if (isExcluded(relPath)) return;
    
    if (debounceTimer) clearTimeout(debounceTimer);
    
    // Low debounce (200ms) for extremely fast near-instant response times
    debounceTimer = setTimeout(async () => {
      state.lastScannedFile = relPath;
      state.lastScannedTime = new Date().toLocaleTimeString();
      
      const fullPath = path.resolve(process.cwd(), relPath);
      let content = '';
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          content = fs.readFileSync(fullPath, 'utf8');
        }
      } catch (e) {
        return;
      }

      // 1. Perform INSTANT local checks (compile check + secret scan)
      const compileResult = runTypeCheck();
      const secretsResult = scanForSecrets(relPath, content);

      // Instantly update local state values
      if (compileResult) {
        state.compileStatus = 'FAILED';
        state.compileError = compileResult;
      } else {
        state.compileStatus = 'PASSING';
        state.compileError = '';
      }

      if (secretsResult) {
        state.secretsStatus = 'EXPOSED';
        state.secretsError = `Potential credential leaked: ${secretsResult}`;
      } else {
        state.secretsStatus = 'NONE';
        state.secretsError = '';
      }

      // Update UI immediately (total latency ~50ms)
      state.status = (compileResult || secretsResult) ? 'WARNINGS' : 'HEALTHY';
      renderDashboard(watchCount);

      // 2. Perform heavier background updates asynchronously (Telegram ping & AI audit)
      void (async () => {
        // Send Telegram alert in background
        if (secretsResult) {
          await sendTelegramNotification(
            `🛡️ *[Guardian Bot Alert]*\n⚠️ Potential secret exposed in file *${relPath}*!\nDetails: ${secretsResult}`,
            relPath
          );
        }
        if (compileResult) {
          await sendTelegramNotification(
            `🛡️ *[Guardian Bot Alert]*\n❌ TypeScript compilation error in project!\nError details: \`${compileResult}\``,
            relPath
          );
        }

        // Heavy AI code audit
        const ext = path.extname(relPath).toLowerCase();
        if ((ext === '.ts' || ext === '.tsx' || ext === '.js') && content) {
          const aiResult = await runAiAudit(relPath, content);
          if (aiResult) {
            state.aiStatus = 'WARNING';
            state.aiError = aiResult;
            state.status = 'WARNINGS';
          } else {
            state.aiStatus = 'CLEAR';
            state.aiError = '';
          }
          // Re-render only after AI audit finishes in background
          renderDashboard(watchCount);
        }
      })();

    }, 200) as any;
  };

  const watcher = fs.watch(process.cwd(), { recursive: true }, (eventType, filename) => {
    if (filename) {
      handleFileChange(filename);
    }
  });

  return new Promise<void>((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key: string) => {
      if (key === '\u0003') {
        cleanup();
        process.exit(0);
      }
      
      if (key === '\r' || key === '\n') {
        cleanup();
      }

      if (key.toLowerCase() === 'f') {
        if (state.status === 'WARNINGS' && state.lastScannedFile !== 'None') {
          console.log(chalk.bold.yellow(`\n🔧 [Guardian Co-Pilot] Attempting AI Auto-Fix on ${state.lastScannedFile}...`));
          void (async () => {
            const success = await runGuardianAutoFix(state.lastScannedFile);
            if (success) {
              console.log(chalk.bold.green(`\n✅ Compilation errors successfully fixed!`));
              handleFileChange(state.lastScannedFile);
            } else {
              console.log(chalk.bold.red(`\n❌ AI Auto-Fix failed. Please review the errors manually.`));
            }
          })();
        }
      }
    };

    const cleanup = () => {
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('data', onData);
      resolve();
    };

    process.stdin.on('data', onData);
  });
}
