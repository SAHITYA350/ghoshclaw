# 🐾 GhoshClaw AI OS

An agentic, multi-agent software development co-pilot designed to run locally on your system, index your codebases, and act as a secure, sandboxed assistant.

---

## 📦 Installation

To install **GhoshClaw** globally on your local machine, run:

```bash
npm install -g sahitya-ghoshclaw
```
*(Alternatively: `bun install -g sahitya-ghoshclaw`)*

---

## 🔑 1. Setup API Keys & Credentials (Step-by-Step)

Before running the agent, you need to configure your local credentials. GhoshClaw stores your credentials **only** on your local machine in `~/.ghoshclaw/.env` (never uploaded). 

Follow these steps to obtain the keys:

### A. Get an OpenRouter API Key (Required for AI features)
1. Visit [OpenRouter](https://openrouter.ai).
2. Sign in with your account.
3. Go to **Account Settings** -> **API Keys** -> click **Create Key**.
4. Save the key. You can use free models to avoid paid tiers.
   - Recommended Free Model: `google/gemma-2-9b-it:free` or `meta-llama/llama-3-8b-instruct:free`
   - Recommended Premium Model: `meta-llama/llama-3.3-70b-instruct`

### B. Create a Telegram Bot & Bot Token (Optional - for remote phone control)
1. Open the Telegram app (or [Telegram Web](https://web.telegram.org)).
2. Search for the user **@BotFather** and start a chat.
3. Send the command:
   ```text
   /newbot
   ```
4. Follow the prompts:
   - Choose a display name for your bot (e.g., `GhoshClaw CoPilot`).
   - Choose a unique username ending with `bot` (e.g., `my_ghoshclaw_copilot_bot`).
5. BotFather will reply with your **Bot Token** (e.g., `1234567890:ABCdef...`).

### C. Find Your Telegram Owner ID (Optional - for securing your bot)
Only the owner's Telegram ID can control the bot.
1. Search Telegram for the bot **@userinfobot**.
2. Start the chat and send any message (like `/start`).
3. The bot will instantly reply with your numeric user ID (e.g., `987654321`).

### D. Get a Firecrawl API Key (Optional - for web scraping and search)
1. Visit [Firecrawl](https://firecrawl.dev).
2. Sign up and navigate to your dashboard.
3. Click **Generate API Key** and copy the key.

---

## ⚙️ 2. Run the Onboarding Wizard

Once you have your credentials, run the interactive setup wizard:

```bash
ghoshclaw init
```

The wizard will prompt you for your keys and securely save them to your home configuration folder:
* **Windows**: `%USERPROFILE%\.ghoshclaw\.env`
* **macOS/Linux**: `~/.ghoshclaw/.env`

---

## 🚀 3. Wake Up the Agent & Usage Examples

Navigate to **any code repository or project directory** on your computer, then wake up the agent:

```bash
ghoshclaw wakeup
```

Choose from the following sub-modes:

### 🖥️ Interactive CLI Sub-Modes
* **Agent-Mode**: Prompt the agent to make code modifications.
  - *Example prompt*: `"Add an input validation to the register function in auth.ts"`
  - *What happens*: GhoshClaw analyzes the file, creates a diff, and prompts you to review and approve the changes.
* **Plan-Mode**: Define a complex multi-step goal.
  - *Example prompt*: `"Write a full README and add Jest unit tests for the utils folder"`
  - *What happens*: GhoshClaw breaks the goal into step-by-step tasks, executes them, and stages files for your review.
* **Ask-Mode**: Ask questions about your codebase.
  - *Example prompt*: `"How does the session middleware authenticate requests?"`
  - *What happens*: GhoshClaw uses its RAG engine to find the exact code snippets and explain the flow.
* **🧠 Multi-Agent Debate**: LangGraph debate between Proposer, Critic, and Risk estimator nodes.
* **🛡️ Background-Guardian**: Recursively watches your workspace. On file save, it runs type-checks and highlights security issues. Press `F` to trigger AI auto-fix.
* **📜 Memory-Timeline**: View all past file edits and shell commands.

### 📱 Telegram Bot Remote Control Commands
If you enabled the Telegram Bot, open a chat with your bot and send:
* `/ask <your question>` — Ask questions about your codebase from your phone.
* `/agent <task description>` — Edit code remotely. The bot will send you inline buttons to **`📋 Show Diff`**, **`✅ Accept All`**, or **`❌ Reject`** the staged edits!
* `/plan <goal description>` — Generate a multi-step plan, toggle steps on your screen, and watch the agent execute them on your computer.

---

## 🏛️ Local Agent Architecture

```mermaid
graph TD
    User([User Request]) --> CLI[Interactive CLI / Telegram]
    CLI --> RAG[RAG & TF-IDF Vector Indexer]
    CLI --> LangGraph[Multi-Agent Debate Graph]
    
    subgraph Multi-Agent debate
        LangGraph --> Proposer[Proposer Node]
        LangGraph --> Critic[Critic Node]
        LangGraph --> Risk[Risk Estimator Node]
        Proposer & Critic & Risk --> Orchestrator[Orchestrator Node]
    end
    
    Orchestrator --> Mutation[Staged File Mutations]
    Review[User Diff Approval Flow]
    Mutation --> Review
    Review -->|Approved| Disk[Write to Disk / Execute]
    Review -->|Rejected| StagingClear[Clear Staged Changes]
    
    Disk --> Timeline[Timeline Logger - memory-timeline.json]
    Disk --> Guardian[Guardian Watch Daemon]
```

### 1. Vector Context (RAG Engine)
When a prompt is received, GhoshClaw uses a custom **TF-IDF vector indexer** at `modes/agent/rag-engine.ts`:
* On startup, it checks file hashes against a disk cache located under `~/.ghoshclaw/` to find changed files in under 2ms.
* It slices text files into overlapping chunks and scores them relative to your query.
* These snippets are injected directly into the LLM system prompt so the agent understands the exact structure of your files.

### 2. Sandbox Security
No code changes are applied directly. All file creations, modifications, and shell commands are queued in an memory staging area. The agent prompts you with an interactive diff, and only writes to disk upon your approval.

---

## ⚙️ Tech Stack & Open Source
GhoshClaw is built on top of robust, modern open-source web technologies:
* **Runtime**: [Bun](https://bun.sh/) (Fast bundler, compiler, and TS runner).
* **AI Engine**: [Vercel AI SDK](https://sdk.vercel.ai/) & [LangGraph JS](https://github.com/langchain-ai/langgraphjs).
* **CLI UX**: [Clack Prompts](https://github.com/natemoo-re/clack), [Chalk](https://github.com/chalk/chalk), [Ora](https://github.com/sindresorhus/ora), and [Boxen](https://github.com/sindresorhus/boxen).
* **Telegram Bot**: [Telegraf](https://github.com/telegraf/telegraf).

---

## 📄 License
This project is open source and distributed under the **MIT License**.