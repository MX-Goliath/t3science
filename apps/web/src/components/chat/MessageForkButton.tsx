import { GitForkIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

export function MessageForkButton({
  onFork,
  size = "icon-xs",
  variant = "ghost",
  className,
}: {
  onFork: () => void;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Fork conversation"
            onClick={onFork}
            type="button"
            size={size}
            variant={variant}
            className={cn("text-muted-foreground hover:text-foreground", className)}
          />
        }
      >
        <GitForkIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>
        <p>Fork conversation</p>
      </TooltipPopup>
    </Tooltip>
  );
}
