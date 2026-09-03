/**
 * M0 verification - independent acceptance check for the physics module.
 *
 * Place this file at the repo root and run:   npx tsx verify-m0.ts
 *
 * If the two imports below don't resolve, fix ONLY those two lines.
 * Do not change any expected value, tolerance, or assertion.
 */

import { simulate } from './packages/physics/src/index';
import { CLUBS } from './packages/shot-source/src/clubs';

const MPH = 0.44704;
const YD = 1.09361;
const FT = 3.28084;
const DEG = Math.PI / 180;
const RPM = Math.PI / 30;

// expected: [carry yds, apex ft, hang s, descent deg]
const GOLDEN: Record<string, [number, number, number, number]> = {
  driver: [224.44, 105, 6.75, 44.0],
  '3w':   [204.60, 103, 6.64, 44.3],
  '5w':   [190.20,  99, 6.42, 44.2],
  '5h':   [170.79,  89, 6.01, 43.4],
  '6i':   [158.58,  86, 5.82, 43.7],
  '7i':   [148.70,  79, 5.55, 42.7],
  '8i':   [138.77,  77, 5.38, 43.0],
  '9i':   [128.45,  74, 5.19, 43.3],
  pw:     [114.21,  71, 4.94, 44.1],
  gw:     [101.36,  63, 4.61, 43.8],
  sw:     [ 88.35,  57, 4.30, 44.0],
  lw:     [ 77.18,  52, 4.03, 44.7],
};

const TOL: [number, number, number, number] = [0.1, 1.0, 0.05, 0.2];

const fails: string[] = [];

function ok(name: string, condition: boolean, detail = '') {
  if (!condition) fails.push(name + (detail ? ' - ' + detail : ''));
}

function shoot(
  speedMph: number,
  launchDeg: number,
  spinRpm: number,
  axisDeg = 0,
  startDeg = 0,
) {
  return simulate({
    ballSpeed: speedMph * MPH,
    launchAngle: launchDeg * DEG,
    spinRate: spinRpm * RPM,
    spinAxis: axisDeg * DEG,
    startLine: startDeg * DEG,
  });
}

// ---------- golden table ----------
console.log('');
console.log('club      carry       delta    apex    hang   descent');
console.log('------------------------------------------------------------');

for (const club of CLUBS as any[]) {
  const g = GOLDEN[club.id];
  if (!g) {
    ok('club:' + club.id, false, 'id not present in golden table');
    continue;
  }

  const t = shoot(club.ballSpeedMph, club.launchDeg, club.spinRpm);
  const got: [number, number, number, number] = [
    t.carry * YD,
    t.apex * FT,
    t.flightTime,
    t.landing.descentAngle / DEG,
  ];

  const good = got.every(
    (v, i) => Number.isFinite(v) && Math.abs(v - g[i]) <= TOL[i],
  );

  ok(
    'golden:' + club.id,
    good,
    good
      ? ''
      : 'carry ' + got[0].toFixed(2) + '/' + g[0] +
        '  apex ' + got[1].toFixed(1) + '/' + g[1] +
        '  hang ' + got[2].toFixed(3) + '/' + g[2] +
        '  descent ' + got[3].toFixed(2) + '/' + g[3],
  );

  const delta = got[0] - g[0];
  console.log(
    String(club.id).padEnd(9) +
      got[0].toFixed(2).padStart(7) +
      ((delta >= 0 ? '+' : '') + delta.toFixed(3)).padStart(10) +
      got[1].toFixed(0).padStart(8) +
      got[2].toFixed(2).padStart(8) +
      got[3].toFixed(1).padStart(9) +
      (good ? '   ok' : '   FAIL'),
  );
}

// ---------- spin-axis frame fix ----------
console.log('');
console.log('start line -> side angle');
for (const aim of [3, 5, 8]) {
  const t = shoot(106, 18.5, 7100, 0, aim);
  const side = Math.atan2(t.lateral, t.carry) / DEG;
  const good = Math.abs(side - aim) <= 0.05;
  ok('frame:' + aim, good, good ? '' : 'got ' + side.toFixed(3) + ' want ' + aim);
  console.log(
    '  aim ' + aim + ' deg  ->  ' + side.toFixed(3) + ' deg   ' + (good ? 'ok' : 'FAIL'),
  );
}

// ---------- invariants ----------
const s = shoot(106, 18.5, 7100);

ok('straight shot has no lateral', Math.abs(s.lateral) < 0.01, String(s.lateral));
ok('lands exactly at y=0', s.landing.position.y === 0, String(s.landing.position.y));
ok(
  'first point is the origin at t=0',
  s.points[0].x === 0 && s.points[0].y === 0 && s.points[0].z === 0 && s.points[0].t === 0,
);
ok(
  'time strictly increases',
  s.points.every((p: any, i: number) => i === 0 || p.t > s.points[i - 1].t),
);
ok('apex exceeds all sampled heights', s.points.every((p: any) => p.y <= s.apex + 1e-9));
ok('descent angle is positive', s.landing.descentAngle > 0);
ok('spin decays in flight', s.landing.spinRate < 7100 * RPM);

const draw = shoot(106, 18.5, 7100, -8);
const fade = shoot(106, 18.5, 7100, 8);
ok('negative axis curves left', draw.lateral < 0, String(draw.lateral));
ok('positive axis curves right', fade.lateral > 0, String(fade.lateral));
ok(
  'draw and fade are symmetric',
  Math.abs(Math.abs(draw.lateral) - Math.abs(fade.lateral)) / Math.abs(fade.lateral) < 0.01,
);

ok(
  'faster ball flies further',
  shoot(120, 18.5, 7100).carry > s.carry && s.carry > shoot(90, 18.5, 7100).carry,
);

let allFinite = true;
for (const speed of [40, 200])
  for (const launch of [4, 45])
    for (const spin of [1000, 11000])
      for (const axis of [-20, 20])
        for (const line of [-10, 10]) {
          const t = shoot(speed, launch, spin, axis, line);
          const vals = [t.carry, t.lateral, t.apex, t.flightTime, t.landing.descentAngle];
          if (!vals.every(Number.isFinite)) allFinite = false;
        }
ok('no NaN across the full input range', allFinite);

// ---------- result ----------
console.log('');
if (fails.length === 0) {
  console.log('M0 VERIFIED - all checks passed.');
} else {
  console.log('M0 NOT VERIFIED - ' + fails.length + ' failed:');
  for (const f of fails) console.log('  x ' + f);
  process.exitCode = 1;
}
