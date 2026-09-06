import type { Hole, Point2 } from "@mulligan/game";
import { useEffect, useRef } from "react";
import { computeCamera, yardsToScreen } from "./camera";
import { BALL_TRACE_COLOR, CANVAS_BG, PIN_CUP_COLOR, SURFACE_COLORS } from "./palette";

export interface MiniHoleTraceProps {
  hole: Hole;
  paths: Point2[][];
  restSpots: Point2[];
}

/**
 * A small, static (drawn once, no animation loop) rendering of the whole
 * hole and every shot played on it -- the scorecard's "how you got here."
 * Deliberately flat: no mowing stripes, no bunker scallop, no soft edges --
 * this is a thumbnail, and that texture work only pays for itself at full
 * canvas size.
 */
export function MiniHoleTrace({ hole, paths, restSpots }: MiniHoleTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const camera = computeCamera(hole.bounds, w, h, 10);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, w, h);
    for (const surface of hole.surfaces) {
      ctx.fillStyle = SURFACE_COLORS[surface.type];
      ctx.beginPath();
      surface.points.forEach((p, i) => {
        const s = yardsToScreen(camera, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = BALL_TRACE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    for (const path of paths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      path.forEach((p, i) => {
        const s = yardsToScreen(camera, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = BALL_TRACE_COLOR;
    for (const rest of restSpots) {
      const s = yardsToScreen(camera, rest);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const pin = yardsToScreen(camera, hole.pin);
    ctx.fillStyle = PIN_CUP_COLOR;
    ctx.beginPath();
    ctx.arc(pin.x, pin.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }, [hole, paths, restSpots]);

  return <canvas ref={canvasRef} className="mini-hole-trace" />;
}
