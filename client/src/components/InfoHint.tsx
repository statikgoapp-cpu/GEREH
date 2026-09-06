import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type InfoHintProps = {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
};

export function InfoHint({ text, side = "top" }: InfoHintProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Info"
            onClick={(event) => event.preventDefault()}
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-72 text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
