/**
 * Single source of truth for slash-command help text and keyboard tips.
 * Consumed by both the /help slash command (terminal.tsx) and the help
 * dialog (help-dialog.tsx) so the two never drift apart.
 */

export interface SlashCommand {
  cmd: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/clear", desc: "Clear the session (keep workspace)" },
  { cmd: "/reset", desc: "Same as /clear" },
  { cmd: "/model <name>", desc: "Switch AI model without opening Settings" },
  { cmd: "/compact", desc: "LLM-summarize old conversation to free context (keeps current task)" },
  { cmd: "/export", desc: "Download the conversation as a Markdown file" },
  { cmd: "/cost", desc: "Estimate cumulative API cost" },
  { cmd: "/tokens", desc: "Show real token usage from the API" },
  { cmd: "/undo", desc: "Undo the last AI file edit (restore snapshot)" },
  { cmd: "/diff", desc: "Show all file changes made this session" },
  { cmd: "/help", desc: "Show this help" },
];

export const TIPS: string[] = [
  "Press Enter to send, Shift+Enter for newline",
  "Click any file path in tool results to open it in the editor",
  "Use Ctrl+S in the editor to save the active file",
  "The AI can call undo_edit itself to revert its own mistakes",
];

/** Render the help text shown by the /help slash command. */
export function buildHelpText(): string {
  return [
    "Slash commands:",
    ...SLASH_COMMANDS.map(({ cmd, desc }) => `  ${cmd.padEnd(18)} ${desc}`),
    "",
    "Tips:",
    ...TIPS.map((t) => `  • ${t}`),
  ].join("\n");
}
