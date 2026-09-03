import type { Hole, Point2, ShotResult, SurfacePolygon } from "@mulligan/game";
import { useEffect, useRef } from "react";
import { computeCamera, effectiveBounds, yardsToScreen, type Bounds, type Camera } from "./camera";
import {
  AIM_LINE_COLOR,
  BALL_FILL,
  BALL_SHADOW,
  BALL_STROKE,
  BALL_TRACE_COLOR,
  BALL_TRACE_GLOW,
  BUNKER_STIPPLE,
  CANVAS_BG,
  FAIRWAY_STRIPE_DARK,
  FAIRWAY_STRIPE_LIGHT,
  LANDING_MARK_COLOR,
  PIN_CUP_COLOR,
  PIN_FLAG_COLOR,
  PIN_POLE_COLOR,
  PREVIOUS_TRACE_ALPHA,
  SURFACE_COLORS,
  WATER_SHIMMER,
} from "./palette";

const FLIGHT_DURATION_MS = 1200;
const ROLL_DURATION_MS = 380;
const AIM_LINE_LENGTH_YDS = 25;
const MAX_LIFT_PX = 42; // how far the ball rises above its shadow at apex, in screen pixels
const YARDAGE_MARK_INTERVAL = 50;

export interface HoleCanvasProps {
  hole: Hole;
  ballPos: Point2;
  aimHeadingRad: number;
  previousPaths: Point2[][]; // faint full flight paths of prior shots this session
  previousRestSpots: Point2[]; // where each of those shots came to rest
  pendingShot: ShotResult | null; // set to animate a new shot; cleared by caller after onShotSettled
  skipAnimation: boolean;
  onShotSettled: () => void;
}

type AnimPhase = "idle" | "flight" | "roll";

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let rafId = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function frame(now: number) {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      const { hole, ballPos, aimHeadingRad, previousPaths, previousRestSpots } = propsRef.current;
      const anim = animRef.current;

      // The static hole bounds don't guarantee every ball position stays in
      // frame -- dispersion (or an extreme manual entry) can carry a shot
      // past them. Keep the ball, and the whole active flight, always
      // visible; never let it render off-canvas.
      const critical: Point2[] = [ballPos];
      if (anim.shot) {
        const path = anim.shot.path2d;
        const stride = Math.max(1, Math.floor(path.length / 40));
        for (let i = 0; i < path.length; i += stride) critical.push(path[i]!);
        critical.push(anim.shot.rest);
      }
      const bounds = effectiveBounds(hole.bounds, critical);
      const camera = computeCamera(bounds, w, h);

      ctx!.clearRect(0, 0, w, h);
      drawSurfaces(ctx!, camera, hole, w, h);
      drawYardageMarks(ctx!, camera, bounds, w);
      drawPreviousTraces(ctx!, camera, previousPaths, previousRestSpots);
      drawPin(ctx!, camera, hole.pin);

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
        drawLandingMark(ctx!, camera, anim.shot.landing, 1 - progress);
        const rollPos = lerpPoint(anim.shot.landing, anim.shot.rest, easeOutCubic(progress));
        drawBallWithShadow(ctx!, camera, rollPos, 0);
        if (progress >= 1) {
          anim.phase = "idle";
          anim.shot = null;
          propsRef.current.onShotSettled();
        }
      } else {
        drawAimLine(ctx!, camera, ballPos, aimHeadingRad);
        drawBallWithShadow(ctx!, camera, ballPos, 0);
      }

      rafId = requestAnimationFrame(frame);
    }

    // A phone screen redrawing at 60fps forever -- including while the tab
    // is backgrounded or the phone is asleep -- is a real battery cost for
    // no visible benefit. Pause the loop entirely when hidden; one frame
    // when it becomes visible again brings the view back up to date
    // (camera/animation state may have changed underneath it while paused).
    function startLoop() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(frame);
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else {
        startLoop();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    startLoop();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", touchAction: "none" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

function lerpPoint(a: Point2, b: Point2, t: number): Point2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clipToPolygon(ctx: CanvasRenderingContext2D, camera: Camera, points: Point2[]) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const s = yardsToScreen(camera, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.clip();
}

function polygonBoundsYds(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function fillPolygon(ctx: CanvasRenderingContext2D, camera: Camera, points: Point2[], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach((p, i) => {
    const s = yardsToScreen(camera, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fill();
}

/** Subtle mowing stripes, perpendicular to the line of play, inside the fairway/tee polygon. */
function drawMowingStripes(ctx: CanvasRenderingContext2D, camera: Camera, surface: SurfacePolygon) {
  ctx.save();
  clipToPolygon(ctx, camera, surface.points);
  const { minY, maxY } = polygonBoundsYds(surface.points);
  const stripeYds = 18;
  let stripeIndex = Math.floor(minY / stripeYds);
  ctx.globalAlpha = 0.4;
  for (let y = Math.floor(minY / stripeYds) * stripeYds; y < maxY; y += stripeYds) {
    const top = yardsToScreen(camera, { x: 0, y: y + stripeYds }).y;
    const bottom = yardsToScreen(camera, { x: 0, y }).y;
    ctx.fillStyle = stripeIndex % 2 === 0 ? FAIRWAY_STRIPE_LIGHT : FAIRWAY_STRIPE_DARK;
    ctx.fillRect(-2, top - 1, 100000, bottom - top + 2);
    stripeIndex++;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** A light, deterministic (non-flickering) sand stipple inside the bunker polygon. */
function drawBunkerTexture(ctx: CanvasRenderingContext2D, camera: Camera, surface: SurfacePolygon) {
  ctx.save();
  clipToPolygon(ctx, camera, surface.points);
  const { minX, maxX, minY, maxY } = polygonBoundsYds(surface.points);
  ctx.fillStyle = BUNKER_STIPPLE;
  const stepYds = 2.2;
  for (let y = minY; y <= maxY; y += stepYds) {
    for (let x = minX; x <= maxX; x += stepYds) {
      const jitter = (Math.round(x * 3) + Math.round(y * 3)) % 2 === 0 ? 0.5 : -0.5;
      const s = yardsToScreen(camera, { x: x + jitter * 0.4, y });
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawWaterShimmer(ctx: CanvasRenderingContext2D, camera: Camera, surface: SurfacePolygon) {
  ctx.save();
  clipToPolygon(ctx, camera, surface.points);
  const { minY, maxY } = polygonBoundsYds(surface.points);
  ctx.strokeStyle = WATER_SHIMMER;
  ctx.lineWidth = 1;
  const bandYds = 6;
  for (let y = minY; y < maxY; y += bandYds) {
    const s = yardsToScreen(camera, { x: -1000, y });
    const e = yardsToScreen(camera, { x: 1000, y });
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSurfaces(ctx: CanvasRenderingContext2D, camera: Camera, hole: Hole, w: number, h: number) {
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, w, h);
  for (const surface of hole.surfaces) {
    fillPolygon(ctx, camera, surface.points, SURFACE_COLORS[surface.type]);
    if (surface.type === "fairway" || surface.type === "tee") drawMowingStripes(ctx, camera, surface);
    if (surface.type === "bunker") drawBunkerTexture(ctx, camera, surface);
    if (surface.type === "water") drawWaterShimmer(ctx, camera, surface);
  }
}

function drawYardageMarks(ctx: CanvasRenderingContext2D, camera: Camera, bounds: Bounds, w: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.fillStyle = "rgba(20,30,25,0.5)";
  ctx.font = "600 10px Archivo, sans-serif";
  ctx.textBaseline = "middle";
  const start = Math.ceil(bounds.minY / YARDAGE_MARK_INTERVAL) * YARDAGE_MARK_INTERVAL;
  for (let y = start; y <= bounds.maxY; y += YARDAGE_MARK_INTERVAL) {
    if (y <= 0) continue;
    const left = yardsToScreen(camera, { x: bounds.minX, y });
    const right = yardsToScreen(camera, { x: bounds.maxX, y });
    ctx.beginPath();
    ctx.moveTo(Math.max(4, left.x), left.y);
    ctx.lineTo(Math.min(w - 4, right.x), right.y);
    ctx.stroke();
    ctx.fillText(String(y), Math.max(6, left.x + 4), left.y - 7);
  }
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, camera: Camera, pin: Point2) {
  const p = yardsToScreen(camera, pin);
  const poleHeight = 24;

  ctx.fillStyle = PIN_CUP_COLOR;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = PIN_POLE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - poleHeight);
  ctx.stroke();

  ctx.fillStyle = PIN_FLAG_COLOR;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - poleHeight);
  ctx.lineTo(p.x + 13, p.y - poleHeight + 5);
  ctx.lineTo(p.x, p.y - poleHeight + 10);
  ctx.closePath();
  ctx.fill();
}

/**
 * Ball shadow at its true ground-track position; the ball itself is lifted
 * (screen-space only -- a top-down view has no vertical axis to move it on)
 * and scaled up toward apex height. The gap that opens between ball and
 * shadow is what actually sells "this is in the air" in a top-down view.
 */
function drawBallWithShadow(ctx: CanvasRenderingContext2D, camera: Camera, groundPos: Point2, heightRatio: number) {
  const ground = yardsToScreen(camera, groundPos);
  const shadowScale = 1 - 0.35 * heightRatio;
  ctx.fillStyle = BALL_SHADOW;
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, 4.5 * shadowScale, 2 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const lift = MAX_LIFT_PX * heightRatio;
  const scale = 1 + 0.35 * heightRatio;
  const r = 4.2 * scale;
  ctx.fillStyle = BALL_FILL;
  ctx.strokeStyle = BALL_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ground.x, ground.y - lift, r, 0, Math.PI * 2);
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
  // a soft glow pass beneath the crisp line reads better against busy surface art
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = BALL_TRACE_GLOW;
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  path.forEach((p, i) => {
    const s = yardsToScreen(camera, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();

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

function drawLandingMark(ctx: CanvasRenderingContext2D, camera: Camera, landing: Point2, alpha: number) {
  if (alpha <= 0) return;
  const s = yardsToScreen(camera, landing);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = LANDING_MARK_COLOR;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPreviousTraces(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  paths: Point2[][],
  restSpots: Point2[],
) {
  for (const path of paths) {
    drawFullTrace(ctx, camera, path, BALL_TRACE_COLOR, PREVIOUS_TRACE_ALPHA);
  }
  ctx.globalAlpha = PREVIOUS_TRACE_ALPHA + 0.15;
  for (const rest of restSpots) {
    const s = yardsToScreen(camera, rest);
    ctx.fillStyle = BALL_FILL;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Draws the trace-so-far plus the ball, lifted above a ground shadow toward apex height. */
function drawAnimatingShot(ctx: CanvasRenderingContext2D, camera: Camera, shot: ShotResult, progress: number) {
  const points = shot.trajectory.points;
  const path2d = shot.path2d;
  const n = Math.max(2, Math.floor(path2d.length * progress));

  drawFullTrace(ctx, camera, path2d.slice(0, n), BALL_TRACE_COLOR, 1);

  const idx = n - 1;
  const heightNow = points[idx]?.y ?? 0;
  const apex = shot.trajectory.apex || 1;
  const groundPos = path2d[idx]!;
  drawBallWithShadow(ctx, camera, groundPos, heightNow / apex);
}
