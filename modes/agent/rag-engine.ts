import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import os from "node:os";
import crypto from "node:crypto";


export interface DocumentChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: Set<string>;
  termFrequencies: Record<string, number>;
}

interface SerializedChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: string[];
  termFrequencies: Record<string, number>;
}

interface CacheData {
  workspacePath: string;
  lastIndexed: string;
  files: Record<string, { mtime: number; size: number }>;
  chunks: SerializedChunk[];
}

export class RAGEngine {
  private chunks: DocumentChunk[] = [];
  private fileMetadata: Record<string, { mtime: number; size: number }> = {};
  private docFrequency: Record<string, number> = {};
  private cachePath: string = "";

  private stopwords = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", 
    "while", "const", "let", "var", "function", "import", "from", "export", 
    "class", "return", "this", "new"
  ]);

  private getCachePath(workspacePath: string): string {
    const configDir = path.join(os.homedir(), ".ghoshclaw");
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const hash = crypto.createHash("md5").update(workspacePath).digest("hex");
    return path.join(configDir, `rag-cache-${hash}.json`);
  }

  private tokenize(text: string): Set<string> {
    const rawTokens = text
      .toLowerCase()
      .split(/[^a-zA-Z0-9_$]+/)
      .filter((t) => t.length > 2);
    const tokens = new Set<string>();
    for (const t of rawTokens) {
      if (!this.stopwords.has(t)) {
        tokens.add(t);
      }
    }
    return tokens;
  }

  // Tokenizes text and returns counts for each unique token (for TF computing)
  private getTermFrequencies(text: string): Record<string, number> {
    const rawTokens = text
      .toLowerCase()
      .split(/[^a-zA-Z0-9_$]+/)
      .filter((t) => t.length > 2);
    const freqs: Record<string, number> = {};
    for (const t of rawTokens) {
      if (!this.stopwords.has(t)) {
        freqs[t] = (freqs[t] || 0) + 1;
      }
    }
    return freqs;
  }

  private loadCache(): void {
    try {
      if (this.cachePath && fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw) as CacheData;
        
        this.fileMetadata = data.files || {};
        this.chunks = (data.chunks || []).map((c) => ({
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
          tokens: new Set(c.tokens),
          termFrequencies: c.termFrequencies || {}
        }));
      }
    } catch (e) {
      // Clear corrupt cache
      this.fileMetadata = {};
      this.chunks = [];
    }
  }

  private saveCache(workspacePath: string): void {
    try {
      if (!this.cachePath) return;
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const serializedChunks: SerializedChunk[] = this.chunks.map((c) => ({
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
        tokens: Array.from(c.tokens),
        termFrequencies: c.termFrequencies
      }));

      const cacheData: CacheData = {
        workspacePath,
        lastIndexed: new Date().toISOString(),
        files: this.fileMetadata,
        chunks: serializedChunks
      };

      fs.writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (e) {
      console.error("Failed to save RAG cache:", e);
    }
  }

  private updateDocFrequencies(): void {
    this.docFrequency = {};
    for (const chunk of this.chunks) {
      for (const token of chunk.tokens) {
        this.docFrequency[token] = (this.docFrequency[token] || 0) + 1;
      }
    }
  }

  async indexCodebase(workspacePath: string): Promise<void> {
    const resolvedWorkspace = path.resolve(workspacePath);
    this.cachePath = this.getCachePath(resolvedWorkspace);

    const startTime = Date.now();
    this.loadCache();

    // Check if user is running from system root/protected directories
    const normalized = resolvedWorkspace.toLowerCase();
    const isSystemDir = 
      normalized === "c:\\" || 
      normalized === "c:\\windows" || 
      normalized === "c:\\windows\\system32" || 
      normalized === "/" || 
      normalized === "/etc" || 
      normalized === "/bin";

    if (isSystemDir) {
      console.log(
        chalk.bold.yellow(
          `\n⚠️  Warning: GhoshClaw is running in a system root directory (${resolvedWorkspace}). Skipping RAG codebase indexing to protect your system.\n`
        )
      );
      this.updateDocFrequencies();
      return;
    }

    const encounteredFiles = new Set<string>();
    let modifiedFilesCount = 0;
    let cachedFilesCount = 0;
    let totalFilesScanned = 0;
    let capWarningShown = false;

    const walk = (dir: string) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        // Soft skip protected/unreadable system directories
        return;
      }

      for (const ent of entries) {
        let fullPath;
        try {
          fullPath = path.join(dir, ent.name);
        } catch (e) {
          continue;
        }

        const relPath = path.relative(resolvedWorkspace, fullPath).replace(/\\/g, "/");

        if (ent.isDirectory()) {
          // Exclude hidden folders and common directories
          if (
            ent.name === "node_modules" || 
            ent.name === ".git" || 
            ent.name === "dist" ||
            ent.name === "build" ||
            ent.name === ".next" ||
            ent.name === ".idea" ||
            ent.name === ".vscode" ||
            ent.name === ".github" ||
            ent.name === "out" ||
            ent.name.startsWith(".")
          ) {
            continue;
          }
          walk(fullPath);
        } else {
          const ext = path.extname(fullPath).toLowerCase();
          const allowedExts = new Set([
            ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html", ".css", ".txt"
          ]);
          if (!allowedExts.has(ext)) continue;

          totalFilesScanned++;
          if (totalFilesScanned > 2000) {
            if (!capWarningShown) {
              console.log(
                chalk.bold.yellow(
                  "\n⚠️  Warning: Current directory contains over 2000 files. Capping indexer to prevent system freeze.\n"
                )
              );
              capWarningShown = true;
            }
            return;
          }

          encounteredFiles.add(relPath);

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 256 * 1024) continue; // Skip files > 256KB

            const mtime = stat.mtimeMs;
            const size = stat.size;
            const cached = this.fileMetadata[relPath];

            if (cached && cached.mtime === mtime && cached.size === size) {
              cachedFilesCount++;
              continue; // Load from cache, skip parsing
            }

            // File modified or new: parse and update chunks
            modifiedFilesCount++;
            this.fileMetadata[relPath] = { mtime, size };
            
            // Remove previous chunks for this file
            this.chunks = this.chunks.filter((c) => c.filePath !== relPath);

            const content = fs.readFileSync(fullPath, "utf8");
            this.chunkFile(relPath, content);
          } catch (e) {}
        }
      }
    };

    if (fs.existsSync(resolvedWorkspace)) {
      walk(resolvedWorkspace);
    }

    // Handle deleted files
    let deletedFilesCount = 0;
    for (const cachedPath of Object.keys(this.fileMetadata)) {
      if (!encounteredFiles.has(cachedPath)) {
        this.chunks = this.chunks.filter((c) => c.filePath !== cachedPath);
        delete this.fileMetadata[cachedPath];
        deletedFilesCount++;
      }
    }

    const indexChanged = modifiedFilesCount > 0 || deletedFilesCount > 0;
    if (indexChanged) {
      this.saveCache(workspacePath);
    }

    this.updateDocFrequencies();
    
    const duration = Date.now() - startTime;
    if (indexChanged) {
      console.log(
        chalk.dim(
          `  ⚡ RAG: Index updated in ${duration}ms (Indexed: ${modifiedFilesCount}, Cached: ${cachedFilesCount}, Deleted: ${deletedFilesCount})`
        )
      );
    } else {
      console.log(chalk.dim(`  ⚡ RAG: Loaded ${this.chunks.length} chunks from cache in ${duration}ms`));
    }
  }

  private chunkFile(filePath: string, content: string) {
    const lines = content.split("\n");
    const chunkSize = 40;
    const overlap = 10;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize);
      if (chunkLines.length === 0) break;
      const chunkContent = chunkLines.join("\n");

      this.chunks.push({
        filePath,
        startLine: i + 1,
        endLine: i + chunkLines.length,
        content: chunkContent,
        tokens: this.tokenize(filePath + " " + chunkContent),
        termFrequencies: this.getTermFrequencies(filePath + " " + chunkContent)
      });

      if (i + chunkSize >= lines.length) break;
    }
  }

  retrieve(query: string, limit = 5): string[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.size === 0 || this.chunks.length === 0) return [];

    const scored = this.chunks.map((chunk) => {
      let score = 0;
      const totalTerms = Object.values(chunk.termFrequencies).reduce((a, b) => a + b, 0) || 1;
      
      for (const t of queryTokens) {
        if (chunk.tokens.has(t)) {
          // Term Frequency (TF) relative to chunk length
          const tf = (chunk.termFrequencies[t] || 0) / totalTerms;
          
          // Inverse Document Frequency (IDF) relative to all chunks
          const df = this.docFrequency[t] || 0;
          const idf = Math.log(1 + this.chunks.length / (1 + df));
          
          score += tf * idf;
        }
      }
      return { chunk, score };
    });

    const top = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => {
        return `[File: ${s.chunk.filePath} (Lines ${s.chunk.startLine}-${s.chunk.endLine})]\n${s.chunk.content}`;
      });

    return top;
  }
}

export async function getCodebaseContext(
  config: { codebasePath: string },
  query: string,
  executor: { analyzeCodebase: (rel: string) => string }
): Promise<string> {
  const rag = new RAGEngine();
  try {
    await rag.indexCodebase(config.codebasePath);
    const snippets = rag.retrieve(query, 8);
    const summary = executor.analyzeCodebase(".");
    
    if (snippets.length === 0) {
      return `Codebase Summary: ${summary}\n\nNo matching files found in context RAG indexing.`;
    }
    
    return [
      `Codebase Summary: ${summary}`,
      "",
      "Relevant code snippets retrieved from the workspace via RAG vector search:",
      "==================================================",
      snippets.join("\n\n"),
      "=================================================="
    ].join("\n");
  } catch (e) {
    return "Failed to analyze codebase context.";
  }
}

