import { headingToward, surfaceAt, type Hole, type Point2, type ShotResult, type SurfacePolygon, type SurfaceType } from "@mulligan/game";
import { radToDeg, degToRad } from "@mulligan/physics";
import { useEffect, useRef } from "react";
import { computeCamera, effectiveBounds, screenToYards, yardsToScreen, type Bounds, type Camera } from "./camera";
import { SURFACE_LABEL } from "./surfaceLabels";
import {
  AIM_LINE_COLOR,
  APEX_MARKER_COLOR,
  BALL_FILL,
  BALL_SHADOW,
  BALL_STROKE,
  BALL_TRACE_COLOR,
  BALL_TRACE_GLOW,
  BUNKER_STIPPLE,
  CANVAS_BG,
  FAIRWAY_STRIPE_DARK,
  FAIRWAY_STRIPE_LIGHT,
  FRINGE_COLOR,
  GHOST_REST_ALPHA,
  GHOST_TRACE_ALPHA,
  GHOST_TRACE_COLOR,
  GREEN_STRIPE_DARK,
  GREEN_STRIPE_LIGHT,
  IMPACT_RING_COLOR,
  PIN_CUP_COLOR,
  PIN_FLAG_COLOR,
  PIN_POLE_COLOR,
  ROUGH_FLECK,
  SURFACE_COLORS,
  SURFACE_EDGE_BLUR_PX,
  WATER_SHIMMER,
} from "./palette";

const FLIGHT_DURATION_MS = 1200;
const ROLL_DURATION_MS = 380;
const IMPACT_RING_DURATION_MS = 260;
const MAX_LIFT_PX = 42; // how far the ball rises above its shadow at apex, in screen pixels
const YARDAGE_MARK_INTERVAL = 50;
// Fraction of full opacity at the trailing (tee) end of a fading trace --
// never fully invisible, just clearly secondary to the leading/ball end.
const TRACE_TEE_ALPHA_FRACTION = 0.22;
/** Matches the old AimSlider's range -- how far off "aimed at pin" a drag/keyboard nudge can go. */
export const AIM_RANGE_DEG = 30;
const AIM_KEY_STEP_DEG = 1;
const AIM_KEY_STEP_DEG_FAST = 5;


export interface HoleCanvasProps {
  hole: Hole;
  ballPos: Point2;
  /** Degrees, relative to "aimed at the pin" -- the committed value; drag/keyboard interaction lives inside this component and reports changes via onAimChange. */
  aimOffsetDeg: number;
  onAimChange: (deg: number) => void;
  /** Disables the aim gesture (mid-flight, or between holes) -- dragging then would change where a shot that isn't happening yet would go, with nothing to show for it. */
  aimLocked: boolean;
  /** The selected club's expected carry, yards -- where the target marker and the live carry/surface readout sit along the aim line. */
  expectedCarryYds: number;
  previousPaths: Point2[][]; // faint full flight paths of prior shots this session
  previousRestSpots: Point2[]; // where each of those shots came to rest
  pendingShot: ShotResult | null; // set to animate a new shot; cleared by caller after onShotSettled
  skipAnimation: boolean;
  /** prefers-reduced-motion: behaves exactly like skipAnimation -- no flight animation, ball jumps to rest. */
  reducedMotion: boolean;
  onShotSettled: () => void;
}

type AnimPhase = "idle" | "flight" | "roll";

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
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

  // The static course background (surfaces, texture, yardage marks, pin) is
  // expensive to draw (blurred edge passes, scalloped bunker outline, noise
  // stipple) but is a pure function of {hole, camera, viewport size} -- and
  // the camera is stable frame-to-frame within a phase (idle, or mid-flight
  // for one shot), since it's derived from ball position / the fixed shot
  // path, neither of which change between rAF ticks. Render it once into an
  // offscreen canvas and blit that every frame instead of repainting from
  // scratch at 60fps -- this is what makes the expensive texture work in
  // Part 1 affordable at all on a phone.
  const bgCacheRef = useRef<{ canvas: HTMLCanvasElement; camera: Camera; w: number; h: number; hole: Hole } | null>(
    null,
  );

  // The latest camera, kept in sync every frame -- pointer events fire
  // independently of the rAF loop and need to convert a screen point to
  // hole-space coordinates (screenToYards) using whatever camera is
  // currently on screen.
  const cameraRef = useRef<Camera | null>(null);
  // Non-null only while an aim drag is active: the live (uncommitted-to-
  // React-yet) aim offset, so the line/target marker track the pointer
  // with zero lag instead of waiting a render cycle on every pointermove.
  const liveAimDegRef = useRef<number | null>(null);

  // Start (or skip) an animation whenever a new pendingShot arrives.
  useEffect(() => {
    if (!props.pendingShot) return;
    if (props.skipAnimation || props.reducedMotion) {
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

    // Part D: drag-to-aim. Converts a pointer position anywhere on the
    // canvas into an aim offset (the heading from the ball through that
    // point, relative to "aimed at the pin"), rather than requiring the
    // drag to start on the aim line itself -- "point your thumb where you
    // want the ball to go" is the whole interaction, with no separate grab
    // handle to find first.
    function aimDegFromClientPoint(clientX: number, clientY: number): number | null {
      const camera = cameraRef.current;
      if (!camera) return null;
      const rect = canvas!.getBoundingClientRect();
      const holePt = screenToYards(camera, { x: clientX - rect.left, y: clientY - rect.top });
      const { ballPos, hole } = propsRef.current;
      const baseHeadingRad = headingToward(ballPos, hole.pin);
      const pointHeadingRad = headingToward(ballPos, holePt);
      let deg = radToDeg(pointHeadingRad - baseHeadingRad);
      deg = ((deg + 180) % 360 + 360) % 360 - 180; // normalize to (-180, 180]
      return Math.max(-AIM_RANGE_DEG, Math.min(AIM_RANGE_DEG, deg));
    }

    let dragging = false;

    function handlePointerDown(e: PointerEvent) {
      if (propsRef.current.aimLocked) return;
      const deg = aimDegFromClientPoint(e.clientX, e.clientY);
      if (deg === null) return;
      dragging = true;
      canvas!.setPointerCapture(e.pointerId);
      liveAimDegRef.current = deg;
      propsRef.current.onAimChange(deg);
    }
    function handlePointerMove(e: PointerEvent) {
      if (!dragging) return;
      const deg = aimDegFromClientPoint(e.clientX, e.clientY);
      if (deg === null) return;
      liveAimDegRef.current = deg;
      propsRef.current.onAimChange(deg);
    }
    function handlePointerUp(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      liveAimDegRef.current = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        // Already released (e.g. pointercancel beat us to it) -- fine.
      }
    }
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    // Keyboard path (Part D + Part E): arrow keys nudge aim, shift+arrow
    // for a bigger step -- desktop and accessibility both need a way to
    // aim that isn't a drag gesture.
    function handleKeyDown(e: KeyboardEvent) {
      if (propsRef.current.aimLocked) return;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -(e.shiftKey ? AIM_KEY_STEP_DEG_FAST : AIM_KEY_STEP_DEG);
      else if (e.key === "ArrowRight") delta = e.shiftKey ? AIM_KEY_STEP_DEG_FAST : AIM_KEY_STEP_DEG;
      else return;
      e.preventDefault();
      const next = Math.max(-AIM_RANGE_DEG, Math.min(AIM_RANGE_DEG, propsRef.current.aimOffsetDeg + delta));
      propsRef.current.onAimChange(next);
    }
    canvas.addEventListener("keydown", handleKeyDown);

    function getBackground(camera: Camera, w: number, h: number, hole: Hole): HTMLCanvasElement {
      const cached = bgCacheRef.current;
      if (
        cached &&
        cached.hole === hole &&
        cached.w === w &&
        cached.h === h &&
        cached.camera.scale === camera.scale &&
        cached.camera.offsetX === camera.offsetX &&
        cached.camera.offsetY === camera.offsetY
      ) {
        return cached.canvas;
      }
      const dpr = window.devicePixelRatio || 1;
      const off = document.createElement("canvas");
      off.width = w * dpr;
      off.height = h * dpr;
      const offCtx = off.getContext("2d")!;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      offCtx.lineCap = "round";
      offCtx.lineJoin = "round";
      drawSurfaces(offCtx, camera, hole, w, h);
      drawYardageMarks(offCtx, camera, effectiveBoundsForHole(hole), w);
      drawPin(offCtx, camera, hole.pin);
      bgCacheRef.current = { canvas: off, camera, w, h, hole };
      return off;
    }

    function effectiveBoundsForHole(hole: Hole): Bounds {
      return hole.bounds;
    }

    function frame(now: number) {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      const { hole, ballPos, aimOffsetDeg, expectedCarryYds, previousPaths, previousRestSpots } = propsRef.current;
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
      cameraRef.current = camera;

      const bg = getBackground(camera, w, h, hole);
      ctx!.clearRect(0, 0, w, h);
      ctx!.drawImage(bg, 0, 0, w, h);
      drawPreviousTraces(ctx!, camera, previousPaths, previousRestSpots);

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
        drawFadedTrace(ctx!, camera, anim.shot.path2d, BALL_TRACE_COLOR, BALL_TRACE_GLOW, 1, apexIndex(anim.shot.trajectory.points));
        const impactProgress = clamp01(elapsed / IMPACT_RING_DURATION_MS);
        drawImpactRing(ctx!, camera, anim.shot.landing, impactProgress);
        const rollPos = lerpPoint(anim.shot.landing, anim.shot.rest, easeOutCubic(progress));
        drawBallWithShadow(ctx!, camera, rollPos, 0);
        if (progress >= 1) {
          anim.phase = "idle";
          anim.shot = null;
          propsRef.current.onShotSettled();
        }
      } else {
        const liveDeg = liveAimDegRef.current ?? aimOffsetDeg;
        const aimHeadingRad = headingToward(ballPos, hole.pin) + degToRad(liveDeg);
        const carryYds = Math.max(5, expectedCarryYds);
        const target: Point2 = {
          x: ballPos.x + carryYds * Math.sin(aimHeadingRad),
          y: ballPos.y + carryYds * Math.cos(aimHeadingRad),
        };
        drawAimLine(ctx!, camera, ballPos, target);
        drawTargetMarker(ctx!, camera, target, carryYds, surfaceAt(hole, target));
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
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const ariaValueDeg = Math.round(props.aimOffsetDeg);
  const ariaLabel =
    ariaValueDeg === 0 ? "Aim: aimed at the pin" : `Aim: ${Math.abs(ariaValueDeg)} degrees ${ariaValueDeg > 0 ? "right" : "left"} of the pin`;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        className="hole-canvas"
        style={{ display: "block" }}
        tabIndex={props.aimLocked ? -1 : 0}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={-AIM_RANGE_DEG}
        aria-valuemax={AIM_RANGE_DEG}
        aria-valuenow={ariaValueDeg}
        aria-valuetext={ariaLabel.replace("Aim: ", "")}
      />
    </div>
  );
}

function lerpPoint(a: Point2, b: Point2, t: number): Point2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function apexIndex(points: readonly { y: number }[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.y > points[best]!.y) best = i;
  }
  return best;
}

function toScreenPoints(camera: Camera, points: Point2[]): Point2[] {
  return points.map((p) => yardsToScreen(camera, p));
}

function pathFromScreenPoints(ctx: CanvasRenderingContext2D, screenPts: Point2[]) {
  ctx.beginPath();
  screenPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function clipToPolygon(ctx: CanvasRenderingContext2D, camera: Camera, points: Point2[]) {
  pathFromScreenPoints(ctx, toScreenPoints(camera, points));
  ctx.clip();
}

function polygonBoundsYds(points: Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Displaces a closed screen-space polygon outline with a low-frequency,
 * deterministic (position-keyed, never Math.random) wobble -- the scalloped
 * bunker edge from Part 1. Amplitude/wavelength are in screen px so the
 * scallop reads at a consistent size regardless of zoom, and resampling
 * happens once per camera change (this only ever runs inside the cached
 * background draw), so the extra point count costs nothing at 60fps.
 */
function scallopedScreenPoints(screenPts: Point2[], amplitudePx: number, wavelengthPx: number): Point2[] {
  const n = screenPts.length;
  if (n < 3) return screenPts;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = screenPts[i]!;
    const b = screenPts[(i + 1) % n]!;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (perimeter < 1) return screenPts;

  const steps = Math.max(24, Math.round(perimeter / Math.max(3, wavelengthPx / 5)));
  const out: Point2[] = [];
  let segIdx = 0;
  let segStart = screenPts[0]!;
  let segEnd = screenPts[1 % n]!;
  let segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y) || 0.0001;
  let segTraveled = 0;

  for (let s = 0; s < steps; s++) {
    const targetDist = (s / steps) * perimeter;
    while (segTraveled + segLen < targetDist && segIdx < n - 1) {
      segTraveled += segLen;
      segIdx++;
      segStart = screenPts[segIdx % n]!;
      segEnd = screenPts[(segIdx + 1) % n]!;
      segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y) || 0.0001;
    }
    const t = clamp01((targetDist - segTraveled) / segLen);
    const px = segStart.x + (segEnd.x - segStart.x) * t;
    const py = segStart.y + (segEnd.y - segStart.y) * t;
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const phase = targetDist / wavelengthPx;
    const noise = Math.sin(phase * Math.PI * 2) * 0.6 + Math.sin(phase * Math.PI * 2 * 2.3 + 1.7) * 0.4;
    const offset = noise * amplitudePx;
    out.push({ x: px + nx * offset, y: py + ny * offset });
  }
  return out;
}

function fillScreenPolygon(ctx: CanvasRenderingContext2D, screenPts: Point2[], color: string) {
  ctx.fillStyle = color;
  pathFromScreenPoints(ctx, screenPts);
  ctx.fill();
}

/**
 * Soft-edged fill: a blurred halo pass first (bleeds a couple of px beyond
 * the polygon into whatever is already painted underneath), then a crisp
 * full-opacity fill of the exact same shape on top. The crisp pass cancels
 * the halo everywhere inside the polygon; only the outward bleed survives,
 * which is exactly "a couple of pixels of blend" at the seam with whatever
 * was drawn before this surface -- cheap because it only runs once per
 * camera change (inside the cached background), not every frame.
 */
function fillScreenPolygonSoft(ctx: CanvasRenderingContext2D, screenPts: Point2[], color: string) {
  ctx.save();
  ctx.filter = `blur(${SURFACE_EDGE_BLUR_PX}px)`;
  fillScreenPolygon(ctx, screenPts, color);
  ctx.restore();
  fillScreenPolygon(ctx, screenPts, color);
}

function fillPolygonSoft(ctx: CanvasRenderingContext2D, camera: Camera, points: Point2[], color: string) {
  fillScreenPolygonSoft(ctx, toScreenPoints(camera, points), color);
}

/** A thin ring of fringe color straddling the green's boundary -- the crisp green fill painted after it covers the inward half, leaving only the outward halo visible. */
function drawFringeRing(ctx: CanvasRenderingContext2D, camera: Camera, points: Point2[]) {
  ctx.save();
  ctx.strokeStyle = FRINGE_COLOR;
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  pathFromScreenPoints(ctx, toScreenPoints(camera, points));
  ctx.stroke();
  ctx.restore();
}

/** Subtle mowing stripes, perpendicular to the line of play, inside a fairway/tee/green polygon. */
function drawMowingStripes(ctx: CanvasRenderingContext2D, camera: Camera, surface: SurfacePolygon, light: string, dark: string, stripeYds: number, alpha: number) {
  ctx.save();
  clipToPolygon(ctx, camera, surface.points);
  const { minY, maxY } = polygonBoundsYds(surface.points);
  let stripeIndex = Math.floor(minY / stripeYds);
  ctx.globalAlpha = alpha;
  for (let y = Math.floor(minY / stripeYds) * stripeYds; y < maxY; y += stripeYds) {
    const top = yardsToScreen(camera, { x: 0, y: y + stripeYds }).y;
    const bottom = yardsToScreen(camera, { x: 0, y }).y;
    ctx.fillStyle = stripeIndex % 2 === 0 ? light : dark;
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

/** Deterministic (hash-based, not Math.random -- no per-frame flicker) fleck texture so rough reads as growth, not a flat fill. */
function drawRoughFleck(ctx: CanvasRenderingContext2D, camera: Camera, surface: SurfacePolygon) {
  ctx.save();
  clipToPolygon(ctx, camera, surface.points);
  const { minX, maxX, minY, maxY } = polygonBoundsYds(surface.points);
  ctx.fillStyle = ROUGH_FLECK;
  const stepYds = 2.4;
  for (let y = minY; y <= maxY; y += stepYds) {
    for (let x = minX; x <= maxX; x += stepYds) {
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const frac = h - Math.floor(h);
      if (frac < 0.6) continue; // sparse -- texture, not noise
      const jx = (frac - 0.5) * 1.6;
      const jy = (((frac * 7) % 1) - 0.5) * 1.6;
      const s = yardsToScreen(camera, { x: x + jx, y: y + jy });
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.7, 0, Math.PI * 2);
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

const BUNKER_SCALLOP_AMPLITUDE_PX = 3.5;
const BUNKER_SCALLOP_WAVELENGTH_PX = 22;

function drawSurfaces(ctx: CanvasRenderingContext2D, camera: Camera, hole: Hole, w: number, h: number) {
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, w, h);
  for (const surface of hole.surfaces) {
    if (surface.type === "green") drawFringeRing(ctx, camera, surface.points);

    if (surface.type === "bunker") {
      const scalloped = scallopedScreenPoints(
        toScreenPoints(camera, surface.points),
        BUNKER_SCALLOP_AMPLITUDE_PX,
        BUNKER_SCALLOP_WAVELENGTH_PX,
      );
      fillScreenPolygonSoft(ctx, scalloped, SURFACE_COLORS[surface.type]);
    } else {
      fillPolygonSoft(ctx, camera, surface.points, SURFACE_COLORS[surface.type]);
    }

    if (surface.type === "fairway" || surface.type === "tee") {
      drawMowingStripes(ctx, camera, surface, FAIRWAY_STRIPE_LIGHT, FAIRWAY_STRIPE_DARK, 18, 0.28);
    }
    if (surface.type === "green") {
      drawMowingStripes(ctx, camera, surface, GREEN_STRIPE_LIGHT, GREEN_STRIPE_DARK, 6, 0.22);
    }
    if (surface.type === "bunker") drawBunkerTexture(ctx, camera, surface);
    if (surface.type === "rough") drawRoughFleck(ctx, camera, surface);
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
 * and scaled up toward apex height. The shadow grows larger and fades as
 * the ball climbs (a deliberately stylized "how high" cue, not a literal
 * overhead-sun shadow) and tightens back to a small, dark, precise ellipse
 * as it descends toward landing -- that tightening is what should read as
 * "about to touch down" even with the trace hidden.
 */
function drawBallWithShadow(ctx: CanvasRenderingContext2D, camera: Camera, groundPos: Point2, heightRatio: number) {
  const ground = yardsToScreen(camera, groundPos);
  const shadowScale = 1 + 0.85 * heightRatio;
  ctx.globalAlpha = 1 - 0.55 * heightRatio;
  ctx.fillStyle = BALL_SHADOW;
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, 4.5 * shadowScale, 2 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const lift = MAX_LIFT_PX * heightRatio;
  const scale = 1 + 0.28 * heightRatio;
  const r = 4.2 * scale;
  ctx.fillStyle = BALL_FILL;
  ctx.strokeStyle = BALL_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ground.x, ground.y - lift, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Part D: the aim line now runs all the way to the target marker (the selected club's expected carry along the current aim), not a fixed decorative length. */
function drawAimLine(ctx: CanvasRenderingContext2D, camera: Camera, ballPos: Point2, target: Point2) {
  const from = yardsToScreen(camera, ballPos);
  const to = yardsToScreen(camera, target);
  ctx.strokeStyle = AIM_LINE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Where the current club's expected carry would land on the current aim
 * line, and what's there -- "choose a target," not "rotate a number."
 * Drawn every idle frame (cheap: one small ring, a couple of short text
 * calls), not cached, since it moves continuously during a drag.
 */
function drawTargetMarker(ctx: CanvasRenderingContext2D, camera: Camera, target: Point2, carryYds: number, surface: SurfaceType) {
  const s = yardsToScreen(camera, target);
  ctx.save();
  ctx.strokeStyle = AIM_LINE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.x - 3, s.y);
  ctx.lineTo(s.x + 3, s.y);
  ctx.moveTo(s.x, s.y - 3);
  ctx.lineTo(s.x, s.y + 3);
  ctx.stroke();

  const label = `${Math.round(carryYds)} yds · ${SURFACE_LABEL[surface]}`;
  ctx.font = "700 11px Archivo, sans-serif";
  const metrics = ctx.measureText(label);
  const padX = 6;
  const boxW = metrics.width + padX * 2;
  const boxH = 18;
  const boxY = s.y - 11 - boxH;
  ctx.fillStyle = "rgba(13,59,37,0.82)";
  const bx = s.x - boxW / 2;
  const radius = 5;
  ctx.beginPath();
  ctx.roundRect(bx, boxY, boxW, boxH, radius);
  ctx.fill();
  ctx.fillStyle = "#F4F1E8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, s.x, boxY + boxH / 2 + 0.5);
  ctx.textAlign = "left";
  ctx.restore();
}

function rgbaWithAlpha(color: string, alpha: number): string {
  // color is always one of this module's rgba(...)/hex palette constants.
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(",").map((s) => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * A trace that fades from translucent at its trailing (tee) end to fully
 * opaque at its leading end -- the ball's current position during flight,
 * or the landing point once at rest. Approximated with a single linear
 * screen-space gradient between the path's first and last point rather
 * than per-segment alpha, which is one cheap gradient fill/stroke instead
 * of dozens of draw calls and reads correctly for the roughly-monotonic
 * shape any golf trajectory actually has.
 */
function drawFadedTrace(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  path: Point2[],
  color: string,
  glowColor: string,
  baseAlpha: number,
  apexIdx?: number,
) {
  if (path.length < 2) return;
  const from = yardsToScreen(camera, path[0]!);
  const to = yardsToScreen(camera, path[path.length - 1]!);

  function gradientFor(baseColor: string): CanvasGradient {
    const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    g.addColorStop(0, rgbaWithAlpha(baseColor, baseAlpha * TRACE_TEE_ALPHA_FRACTION));
    g.addColorStop(1, rgbaWithAlpha(baseColor, baseAlpha));
    return g;
  }

  // a soft glow pass beneath the crisp line reads better against busy surface art
  ctx.strokeStyle = gradientFor(glowColor);
  ctx.lineWidth = 5.5;
  pathFromScreenPoints(ctx, toScreenPoints(camera, path));
  ctx.stroke();

  ctx.strokeStyle = gradientFor(color);
  ctx.lineWidth = 2.5;
  pathFromScreenPoints(ctx, toScreenPoints(camera, path));
  ctx.stroke();

  if (apexIdx !== undefined && apexIdx > 0 && apexIdx < path.length - 1) {
    drawApexMarker(ctx, camera, path[apexIdx]!);
  }
}

function drawApexMarker(ctx: CanvasRenderingContext2D, camera: Camera, pos: Point2) {
  const s = yardsToScreen(camera, pos);
  ctx.save();
  ctx.strokeStyle = APEX_MARKER_COLOR;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(s.x - 3.5, s.y);
  ctx.lineTo(s.x + 3.5, s.y);
  ctx.moveTo(s.x, s.y - 3.5);
  ctx.lineTo(s.x, s.y + 3.5);
  ctx.stroke();
  ctx.restore();
}

/** A brief expanding, fading ring at the moment of landing -- the "impact." */
function drawImpactRing(ctx: CanvasRenderingContext2D, camera: Camera, landing: Point2, progress: number) {
  if (progress >= 1) return;
  const s = yardsToScreen(camera, landing);
  const radius = 3 + 13 * easeOutCubic(progress);
  ctx.save();
  ctx.globalAlpha = 0.9 * (1 - progress);
  ctx.strokeStyle = IMPACT_RING_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPreviousTraces(ctx: CanvasRenderingContext2D, camera: Camera, paths: Point2[][], restSpots: Point2[]) {
  for (const path of paths) {
    drawFadedTrace(ctx, camera, path, GHOST_TRACE_COLOR, GHOST_TRACE_COLOR, GHOST_TRACE_ALPHA);
  }
  ctx.globalAlpha = GHOST_REST_ALPHA;
  for (const rest of restSpots) {
    const s = yardsToScreen(camera, rest);
    ctx.fillStyle = GHOST_TRACE_COLOR;
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
  const apexIdx = apexIndex(points);

  drawFadedTrace(ctx, camera, path2d.slice(0, n), BALL_TRACE_COLOR, BALL_TRACE_GLOW, 1, n - 1 >= apexIdx ? apexIdx : undefined);

  const idx = n - 1;
  const heightNow = points[idx]?.y ?? 0;
  const apex = shot.trajectory.apex || 1;
  const groundPos = path2d[idx]!;
  drawBallWithShadow(ctx, camera, groundPos, heightNow / apex);
}
