# Third-party notices

## Z.AI ZCode composer UI

The responsive conversation width and composer shell in `src/components/terminal.tsx` are adapted from Z.AI ZCode's `ChatPromptEditor` and `ConversationComposer` at commit `aac4755666d09fdcd70272fcf063c077a639015f`:

- https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/prompt-editor/ChatPromptEditor.tsx
- https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/ui/src/v4/ConversationComposer.tsx

Copyright 2026 Z.A.I. Co., Ltd. Used under the Apache License, Version 2.0. A copy is included at `LICENSES/ZCode-Apache-2.0.txt`.

The layout and visual shell were adapted for OpenCodeCLI. OpenCodeCLI's editor, send behavior, attachments, model controls, and session state remain project-specific. The upstream ZCode `NOTICE.md` identifies its first-party code as Apache-2.0; this notice records only the attribution relevant to the adapted composer UI.
