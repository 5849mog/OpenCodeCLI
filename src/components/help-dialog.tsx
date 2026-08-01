"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SLASH_COMMANDS, TIPS } from "@/lib/help-content";

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Help / command reference panel, replacing the old alert() help buttons. */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="帮助"
      description="Slash 命令与快捷键速查"
      className="w-[95vw] max-w-lg"
    >
      <CommandInput placeholder="搜索命令或技巧…" />
      <CommandList>
        <CommandEmpty>无匹配结果</CommandEmpty>
        <CommandGroup heading="Slash 命令">
          {SLASH_COMMANDS.map(({ cmd, desc }) => (
            <CommandItem key={cmd} value={`${cmd} ${desc}`}>
              <span className="font-mono text-xs text-[#D97757]">{cmd}</span>
              <span className="text-muted-foreground">{desc}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="快捷键与技巧">
          {TIPS.map((tip) => (
            <CommandItem key={tip} value={tip}>
              <span>{tip}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
