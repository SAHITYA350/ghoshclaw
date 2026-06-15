import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

let groqInstance: Groq | null = null;

export function getGroqClient(): Groq {
  if (!groqInstance) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }
    groqInstance = new Groq({ apiKey });
  }
  return groqInstance;
}
