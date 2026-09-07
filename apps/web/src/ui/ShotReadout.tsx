import type { ClubProfile, Provenance, ShotEvent } from "@mulligan/shot-source";
import { useEffect, useRef, useState } from "react";
import { DUR_SLOW_MS } from "../motion";
import { distanceUnitLabel, distanceValue, type UnitSystem } from "../preferences";

export interface ShotReadoutData {
  key: string; // unique per shot (e.g. timestamp) -- restarts the count-up
  club: ClubProfile;
  carryYds: number;
  totalYds: number;
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
  provenance: ShotEvent["provenance"];
}

export interface ShotReadoutProps {
  data: ShotReadoutData | null;
  skipAnimation: boolean;
  unit: UnitSystem;
}

const READOUT_DURATION_MS = Math.min(800, DUR_SLOW_MS);

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

/** One shared rAF loop animating every number in the readout together, keyed to `trigger` (the shot key). */
function useCountUp(targets: number[], trigger: string, durationMs: number, skip: boolean): number[] {
  const [values, setValues] = useState(targets);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    if (skip) {
      setValues(targetsRef.current);
      return;
    }
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOutQuint(t);
      setValues(targetsRef.current.map((v) => v * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // trigger alone intentionally governs re-running this -- targets for the
    // same shot don't change mid-animation.
  }, [trigger, skip, durationMs]);

  return values;
}

const FIELD_LABEL = { ballSpeed: "Ball speed", launch: "Launch", spin: "Spin" } as const;

function ReadoutTile({ label, value, unit, provenance }: { label: string; value: string; unit: string; provenance: Provenance }) {
  return (
    <div className={"readout-tile " + provenance}>
      <div className="readout-tile-value">
        {value}
        <span className="readout-tile-unit">{unit}</span>
      </div>
      <div className="readout-tile-label">{label}</div>
    </div>
  );
}

/**
 * The product's signature moment: after every shot, the numbers that came
 * off the club. Provenance is encoded visually (a solid tinted tile for a
 * measured value, a dashed outline + muted text for an estimated one) so it
 * reads at a glance without anyone reading a label -- no other golf game
 * tells you which numbers came from your actual swing.
 *
 * Before the first shot of a hole, this slot shows a one-line prompt
 * instead of sitting blank (Part 5's empty-state rule).
 */
export function ShotReadout({ data, skipAnimation, unit }: ShotReadoutProps) {
  const targets = data ? [data.carryYds, data.ballSpeedMph, data.launchDeg, data.spinRpm] : [0, 0, 0, 0];
  const [carry, ballSpeed, launch, spin] = useCountUp(targets, data?.key ?? "none", READOUT_DURATION_MS, skipAnimation || !data);

  if (!data) {
    return (
      <div className="readout readout-empty">
        <span>Pick a club and swing — your shot numbers will show up here.</span>
      </div>
    );
  }

  return (
    <div className="readout">
      <div className="readout-headline">
        <span className="readout-club">{data.club.name}</span>
        <span className="readout-carry">
          {distanceValue(carry!, unit)}
          <span className="readout-carry-unit">{distanceUnitLabel(unit)} carry</span>
        </span>
        <span className="readout-total">
          {distanceValue(data.totalYds, unit)} total
        </span>
      </div>
      <div className="readout-tiles">
        <ReadoutTile label={FIELD_LABEL.ballSpeed} value={Math.round(ballSpeed!).toString()} unit="mph" provenance={data.provenance.ballSpeed} />
        <ReadoutTile label={FIELD_LABEL.launch} value={launch!.toFixed(1)} unit="°" provenance={data.provenance.launch} />
        <ReadoutTile label={FIELD_LABEL.spin} value={Math.round(spin!).toLocaleString()} unit="rpm" provenance={data.provenance.spin} />
      </div>
      <div className="readout-legend">
        <span className="legend-item">
          <span className="legend-swatch measured" /> measured
        </span>
        <span className="legend-item">
          <span className="legend-swatch estimated" /> estimated
        </span>
      </div>
    </div>
  );
}
