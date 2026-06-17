import chalk from "chalk";
import type { ToolExecutor } from "./tool-executor";
import type { ActionTracker } from "./action-tracker";

export function extractAndExecuteTextualToolCall(
  text: string,
  executor: ToolExecutor,
  tracker: ActionTracker
): boolean {
  // Matches raw JSON objects or JSON markdown blocks
  const jsonRegex = /(?:```json\s*)?(\{[\s\S]+?\})(?:\s*```)?/g;
  let match;
  let executedAny = false;

  while ((match = jsonRegex.exec(text)) !== null) {
    try {
      const rawJson = match[1];
      if (!rawJson) continue;
      const parsed = JSON.parse(rawJson);

      // Check if it matches a standard function call format
      const name = parsed.name || (parsed.type === "function" && parsed.name);
      const params = parsed.parameters || parsed.arguments || parsed.args || parsed.input;

      if (name && params) {
        console.log(chalk.yellow(`\n⚡ Detected textual tool call fallback: ${name}`));

        if (name === "create_file") {
          executor.createFile(params.path || "", params.content || "");
          executedAny = true;
        } else if (name === "modify_file") {
          executor.modifyFile(params.path || "", params.content || "");
          executedAny = true;
        } else if (name === "create_folder") {
          executor.createFolder(params.path || "");
          executedAny = true;
        } else if (name === "delete_file") {
          executor.deleteFile(params.path || "");
          executedAny = true;
        } else if (name === "execute_shell") {
          executor.queueShell(params.command || "");
          executedAny = true;
        }
      }
    } catch (e) {
      // Continue searching
    }
  }

  return executedAny;
}
