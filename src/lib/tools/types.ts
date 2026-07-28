export interface ToolResult {
  ok: boolean;
  output: string;
  /** Structured diff for edit operations, used by the UI. */
  diff?: { path: string; before: string; after: string };
  /** Plan content for update_plan — UI renders this as a checkbox list,
   * NOT as a diff. */
  plan?: string;
  /** The tool that produced this result, for UI rendering. */
  tool: string;
  /** The arguments the AI passed, for UI rendering. */
  args: Record<string, unknown>;
  /** Whether this tool call modified the VFS. */
  mutated?: boolean;
}
