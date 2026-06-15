import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import dotenv from "dotenv";
dotenv.config();

export function getAgentModel () {
    const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const modelId = process.env.OPENROUTER_DEFAULT_MODEL;
    if (!modelId) {
        throw new Error("OPENROUTER_DEFAULT_MODEL is not set");
    }
    return provider(modelId);
}
