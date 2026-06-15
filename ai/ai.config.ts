import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGroq } from "@ai-sdk/groq";
import dotenv from "dotenv";
dotenv.config();

export function getAgentModel(): any {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (openRouterKey && openRouterKey.trim() !== "") {
    const provider = createOpenRouter({ apiKey: openRouterKey });
    const modelId = process.env.OPENROUTER_DEFAULT_MODEL || "meta-llama/llama-3.3-70b-instruct";
    return provider(modelId);
  }

  if (groqKey && groqKey.trim() !== "") {
    const provider = createGroq({ apiKey: groqKey });
    const modelId = process.env.GROQ_DEFAULT_MODEL || "llama-3.3-70b-versatile";
    return provider(modelId);
  }

  throw new Error("No AI provider (OpenRouter or Groq) is configured. Run 'ghoshclaw init' to setup keys.");
}
