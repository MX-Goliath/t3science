import { msg } from "gt-react";
import { type RuntimeMode } from "@t3tools/contracts";
import {
  type LucideIcon,
  LockIcon,
  PenLineIcon,
  ShieldOffIcon,
  ShieldCheckIcon,
} from "lucide-react";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon; iconClassName?: string }
> = {
  "approval-required": {
    label: msg("Supervised"),
    description: msg("Ask before commands and file changes."),
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: msg("Auto-accept edits"),
    description: msg("Auto-approve edits, ask before other actions."),
    icon: PenLineIcon,
  },
  auto: {
    label: msg("Auto"),
    description: msg("Supported providers approve routine actions; others still ask."),
    icon: ShieldCheckIcon,
  },
  "full-access": {
    label: msg("Full access"),
    description: msg("Allow commands and edits without prompts."),
    // An open lock reads like a closed one at small sizes; a crossed shield does not.
    icon: ShieldOffIcon,
    iconClassName: "text-orange-500",
  },
};
