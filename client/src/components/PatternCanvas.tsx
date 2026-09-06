import { useEffect, useRef, forwardRef } from "react";
import type { StonePattern } from "./rhinestone-fill-engine";

interface Props {
  pattern: StonePattern;
  stoneStyle?: "filled" | "outline";
}

const PatternCanvas = forwardRef<HTMLCanvasElement, Props>(({ pattern, stoneStyle = "filled" }, ref) => {
  const internalRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = (ref as React.RefObject<HTMLCanvasElement>) ?? internalRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = pattern.width;
    canvas.height = pattern.height;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pattern.width, pattern.height);

    for (const stone of pattern.stones) {
      const { x, y, radius, color } = stone;

      if (stoneStyle === "outline") {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgb(${color.r},${color.g},${color.b})`;
        ctx.lineWidth = Math.max(0.8, radius * 0.18);
        ctx.stroke();
      } else {
        const gradient = ctx.createRadialGradient(
          x - radius * 0.3,
          y - radius * 0.3,
          radius * 0.05,
          x,
          y,
          radius
        );

        const lighten = (v: number) => Math.min(255, v + 60);
        const darken = (v: number) => Math.max(0, v - 40);

        gradient.addColorStop(0, `rgb(${lighten(color.r)},${lighten(color.g)},${lighten(color.b)})`);
        gradient.addColorStop(0.6, `rgb(${color.r},${color.g},${color.b})`);
        gradient.addColorStop(1, `rgb(${darken(color.r)},${darken(color.g)},${darken(color.b)})`);

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 0.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fill();
      }
    }
  }, [pattern, stoneStyle]);

  return (
    <div className="w-full overflow-auto bg-white">
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto"
        style={{ display: "block" }}
      />
    </div>
  );
});

PatternCanvas.displayName = "PatternCanvas";

export default PatternCanvas;
