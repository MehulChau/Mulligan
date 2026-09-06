import { useEffect, useRef } from "react";
import { BALL_TRACE_COLOR, CANVAS_BG, PIN_CUP_COLOR } from "./palette";

export interface DispersionPoint {
  lateralYds: number; // + right, relative to the aim line
  carryYds: number;
}

export interface DispersionPlotProps {
  points: DispersionPoint[];
  size?: number;
}

/**
 * "The single most readable launch-monitor visual" (Part F) -- a top-down
 * scatter of where a club's shots actually landed, relative to the aim
 * line, not the hole. Small and static (drawn once per data change, no
 * animation loop -- this is a summary view, not the live hole), same
 * flat-canvas posture as MiniHoleTrace.
 */
export function DispersionPlot({ points, size = 96 }: DispersionPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, size, size);

    const medianCarry = [...points].map((p) => p.carryYds).sort((a, b) => a - b)[Math.floor(points.length / 2)]!;
    // Fit both axes to the actual spread (with a floor so one tight club
    // doesn't zoom in to look artificially scattered) -- centered on the
    // median carry vertically and on 0 lateral horizontally, since that's
    // "the target" this plot is relative to.
    const maxLateral = Math.max(8, ...points.map((p) => Math.abs(p.lateralYds) * 1.3));
    const maxCarrySpread = Math.max(6, ...points.map((p) => Math.abs(p.carryYds - medianCarry) * 1.3));

    function toScreen(p: DispersionPoint) {
      return {
        x: size / 2 + (p.lateralYds / maxLateral) * (size / 2 - 8),
        y: size / 2 - ((p.carryYds - medianCarry) / maxCarrySpread) * (size / 2 - 8),
      };
    }

    // Target crosshair at the median -- "relative to target" reads as
    // "relative to what this club's own shots centered on," since there's
    // no single external target distance stored per club in the log.
    const center = toScreen({ lateralYds: 0, carryYds: medianCarry });
    ctx.strokeStyle = PIN_CUP_COLOR;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(center.x - 5, center.y);
    ctx.lineTo(center.x + 5, center.y);
    ctx.moveTo(center.x, center.y - 5);
    ctx.lineTo(center.x, center.y + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = BALL_TRACE_COLOR;
    for (const p of points) {
      const s = toScreen(p);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [points, size]);

  if (points.length === 0) return null;
  return <canvas ref={canvasRef} className="dispersion-plot" style={{ width: size, height: size }} aria-hidden="true" />;
}
