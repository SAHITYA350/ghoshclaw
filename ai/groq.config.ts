import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

let groqInstance: any = null;

export function getGroqClient(): any {
  if (!groqInstance) {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey && apiKey.trim() !== "") {
      groqInstance = new Groq({ apiKey });
    } else {
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      if (openRouterKey && openRouterKey.trim() !== "") {
        // Configure Groq SDK client to point to OpenRouter!
        groqInstance = new Groq({
          apiKey: openRouterKey,
          baseURL: "https://openrouter.ai/api/v1",
        });
        
        // Proxy the chat completions to swap Groq model ID with OpenRouter default model
        const originalCreate = groqInstance.chat.completions.create.bind(groqInstance.chat.completions);
        groqInstance.chat.completions.create = async function (params: any, options: any) {
          if (params.model === "llama-3.3-70b-versatile" || !params.model) {
            params.model = process.env.OPENROUTER_DEFAULT_MODEL || "meta-llama/llama-3.3-70b-instruct";
          }
          return originalCreate(params, options);
        };
      } else {
        throw new Error("Neither GROQ_API_KEY nor OPENROUTER_API_KEY is configured. Run 'ghoshclaw init' to setup keys.");
      }
    }
  }
  return groqInstance;
}
