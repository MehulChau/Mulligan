import type { Hole, Point2, ShotResult } from "@mulligan/game";
import { useEffect, useRef } from "react";
import { computeCamera, yardsToScreen, type Camera } from "./camera";
import {
  AIM_LINE_COLOR,
  BALL_FILL,
  BALL_STROKE,
  BALL_TRACE_COLOR,
  CANVAS_BG,
  PIN_FLAG_COLOR,
  PIN_POLE_COLOR,
  PREVIOUS_TRACE_ALPHA,
  SURFACE_COLORS,
} from "./palette";

const FLIGHT_DURATION_MS = 1200;
const ROLL_DURATION_MS = 350;
const AIM_LINE_LENGTH_YDS = 25;

export interface HoleCanvasProps {
  hole: Hole;
  ballPos: Point2;
  aimHeadingRad: number;
  previousPaths: Point2[][]; // faint full flight paths of prior shots this session
  pendingShot: ShotResult | null; // set to animate a new shot; cleared by caller after onShotSettled
  skipAnimation: boolean;
  onShotSettled: () => void;
}

type AnimPhase = "idle" | "flight" | "roll";

export function HoleCanvas(props: HoleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest props, read from inside the rAF loop without re-subscribing it.
  const propsRef = useRef(props);
  propsRef.current = props;

  const animRef = useRef<{
    phase: AnimPhase;
    startedAt: number;
    shot: ShotResult | null;
  }>({ phase: "idle", startedAt: 0, shot: null });

  // Start (or skip) an animation whenever a new pendingShot arrives.
  useEffect(() => {
    if (!props.pendingShot) return;
    if (props.skipAnimation) {
      props.onShotSettled();
      return;
    }
    animRef.current = { phase: "flight", startedAt: performance.now(), shot: props.pendingShot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingShot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function frame(now: number) {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      const { hole, ballPos, aimHeadingRad, previousPaths } = propsRef.current;
      const camera = computeCamera(hole, w, h);

      ctx!.clearRect(0, 0, w, h);
      drawSurfaces(ctx!, camera, hole, w, h);
      drawPreviousTraces(ctx!, camera, previousPaths);
      drawPin(ctx!, camera, hole.pin);

      const anim = animRef.current;
      if (anim.phase === "flight" && anim.shot) {
        const elapsed = now - anim.startedAt;
        const progress = Math.min(1, elapsed / FLIGHT_DURATION_MS);
        drawAnimatingShot(ctx!, camera, anim.shot, progress);
        if (progress >= 1) {
          anim.phase = "roll";
          anim.startedAt = now;
        }
      } else if (anim.phase === "roll" && anim.shot) {
        const elapsed = now - anim.startedAt;
        const progress = Math.min(1, elapsed / ROLL_DURATION_MS);
        drawFullTrace(ctx!, camera, anim.shot.path2d, BALL_TRACE_COLOR, 1);
        const rollPos = lerpPoint(anim.shot.landing, anim.shot.rest, progress);
        drawBall(ctx!, camera, rollPos, 1);
        if (progress >= 1) {
          anim.phase = "idle";
          anim.shot = null;
          propsRef.current.onShotSettled();
        }
      } else {
        drawAimLine(ctx!, camera, ballPos, aimHeadingRad);
        drawBall(ctx!, camera, ballPos, 1);
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

function lerpPoint(a: Point2, b: Point2, t: number): Point2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawSurfaces(ctx: CanvasRenderingContext2D, camera: Camera, hole: Hole, w: number, h: number) {
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
}

function drawPin(ctx: CanvasRenderingContext2D, camera: Camera, pin: Point2) {
  const p = yardsToScreen(camera, pin);
  const poleHeight = 22;
  ctx.strokeStyle = PIN_POLE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - poleHeight);
  ctx.stroke();

  ctx.fillStyle = PIN_FLAG_COLOR;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - poleHeight);
  ctx.lineTo(p.x + 12, p.y - poleHeight + 5);
  ctx.lineTo(p.x, p.y - poleHeight + 10);
  ctx.closePath();
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, camera: Camera, pos: Point2, scale: number) {
  const s = yardsToScreen(camera, pos);
  const r = 4.5 * scale;
  ctx.fillStyle = BALL_FILL;
  ctx.strokeStyle = BALL_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawAimLine(ctx: CanvasRenderingContext2D, camera: Camera, ballPos: Point2, headingRad: number) {
  const tip: Point2 = {
    x: ballPos.x + AIM_LINE_LENGTH_YDS * Math.sin(headingRad),
    y: ballPos.y + AIM_LINE_LENGTH_YDS * Math.cos(headingRad),
  };
  const from = yardsToScreen(camera, ballPos);
  const to = yardsToScreen(camera, tip);
  ctx.strokeStyle = AIM_LINE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFullTrace(ctx: CanvasRenderingContext2D, camera: Camera, path: Point2[], color: string, alpha: number) {
  if (path.length < 2) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  path.forEach((p, i) => {
    const s = yardsToScreen(camera, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPreviousTraces(ctx: CanvasRenderingContext2D, camera: Camera, paths: Point2[][]) {
  for (const path of paths) {
    drawFullTrace(ctx, camera, path, BALL_TRACE_COLOR, PREVIOUS_TRACE_ALPHA);
  }
}

/** Draws the trace-so-far plus the ball, scaled up near apex to suggest height. */
function drawAnimatingShot(ctx: CanvasRenderingContext2D, camera: Camera, shot: ShotResult, progress: number) {
  const points = shot.trajectory.points;
  const path2d = shot.path2d;
  const n = Math.max(2, Math.floor(path2d.length * progress));

  drawFullTrace(ctx, camera, path2d.slice(0, n), BALL_TRACE_COLOR, 1);

  const idx = n - 1;
  const heightNow = points[idx]?.y ?? 0;
  const apex = shot.trajectory.apex || 1;
  const scale = 1 + 0.6 * (heightNow / apex);
  const ballPos = path2d[idx]!;
  drawBall(ctx, camera, ballPos, scale);
}
