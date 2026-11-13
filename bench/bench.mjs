// Real timings: warmup 1 + >=7 samples, median/min/p95/stddev + cold start.
import { readFileSync, writeFileSync } from "node:fs";
import * as C from "../src/core.mjs";

const meshes = JSON.parse(readFileSync("data/meshes.json"));
const polys = JSON.parse(readFileSync("data/polygons.json"));
const SAMPLES = 9;

const stats = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return {
    n: s.length,
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)],
    stddev: sd,
    rsdPct: mean === 0 ? 0 : (sd / mean) * 100,
  };
};
const time = (fn) => {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
};

const out = { node: process.version, samples: SAMPLES, corpus: {}, timings: {}, correctness: {}, notes: [] };

// ---------------- fill pipeline over the 6-mesh corpus -------------------
const coldFill = time(() => { for (const m of meshes) C.fillHoles(m); });
const fillSamples = [];
// warmup
time(() => { for (const m of meshes) C.fillHoles(m); });
for (let s = 0; s < SAMPLES; s++) {
  fillSamples.push(time(() => { for (const m of meshes) C.fillHoles(m); }));
}
out.timings.fillAll6 = { coldStartMs: coldFill, ...stats(fillSamples) };

// per-mesh median
out.timings.perMesh = {};
for (const m of meshes) {
  const cold = time(() => C.fillHoles(m));
  const xs = [];
  for (let s = 0; s < SAMPLES; s++) xs.push(time(() => C.fillHoles(m)));
  out.timings.perMesh[m.name] = { triangles: m.triangles.length, coldStartMs: cold, ...stats(xs) };
}

// ---------------- DP vs brute-force minimax, n=8 ------------------------
let seed = 999;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const n8 = Array.from({ length: 8 }, (_, k) => {
  const a = (2 * Math.PI * k) / 8, r = 0.2 + rnd() * 1.0;
  return [r * Math.cos(a), r * Math.sin(a)];
});
const coldDp = time(() => C.minimaxTriangulation(n8, 0));
const coldBrute = time(() => C.bruteForceMinimax(n8, 0));
const dpSamples = [], bruteSamples = [];
for (let s = 0; s < SAMPLES; s++) dpSamples.push(time(() => { for (let i = 0; i < 2000; i++) C.minimaxTriangulation(n8, 0); }));
for (let s = 0; s < SAMPLES; s++) bruteSamples.push(time(() => { for (let i = 0; i < 2000; i++) C.bruteForceMinimax(n8, 0); }));
out.timings.dp2000 = { coldStartMs: coldDp, ...stats(dpSamples) };
out.timings.brute200 = { coldStartMs: coldBrute, ...stats(bruteSamples) };
out.timings.dpPerPolygonMs = out.timings.dp2000.median / 2000;
out.timings.brutePerPolygonMs = out.timings.brute200.median / 2000;
out.timings.speedupDpVsBrute = out.timings.brutePerPolygonMs / out.timings.dpPerPolygonMs;

// ---------------- ear clip vs minimax ----------------------------------
const earSamples = [];
const coldEar = time(() => { for (const p of polys) C.earClip(p.points); });
for (let s = 0; s < SAMPLES; s++) earSamples.push(time(() => { for (let i = 0; i < 500; i++) for (const p of polys) C.earClip(p.points); }));
out.timings.earClip30x500 = { coldStartMs: coldEar, ...stats(earSamples) };
out.timings.earClip30PerMs = out.timings.earClip30x500.median / 500;

// ---------------- correctness snapshot ---------------------------------
out.corpus.meshes = meshes.length;
out.corpus.holes = 0;
out.corpus.boundaryBefore = 0;
out.corpus.boundaryAfter = 0;
out.corpus.addedTriangles = 0;
out.corpus.allClosed = true;
for (const m of meshes) {
  const r = C.fillHoles(m);
  const v = C.verifyFill(m, r);
  out.corpus.holes += r.loops;
  out.corpus.boundaryBefore += v.boundaryBefore;
  out.corpus.boundaryAfter += v.boundaryAfter;
  out.corpus.addedTriangles += v.addedTriangles;
  out.corpus.allClosed = out.corpus.allClosed && v.closedAfter;
  out.corpus[`${m.name}_holes`] = r.loops;
}
let dpEq = 0, earWorse = 0, worst = 1;
for (const p of polys) {
  const dp = C.minimaxTriangulation(p.points, 0);
  const ear = C.earClip(p.points);
  if (p.convex) {
    const bf = C.bruteForceMinimax(p.points, 0);
    if (Math.abs(dp.maxArea - bf.maxArea) <= 1e-12 * Math.max(1, bf.maxArea)) dpEq++;
  }
  if (ear.maxArea > dp.maxArea * (1 + 1e-9)) earWorse++;
  worst = Math.max(worst, ear.maxArea / dp.maxArea);
}
out.correctness.convexBruteEqual = `${dpEq}/${polys.filter((p) => p.convex).length}`;
out.correctness.earClipSuboptimal = `${earWorse}/${polys.length}`;
out.correctness.worstEarPenalty = worst;
out.correctness.dpMaxAreaVsBrute = (() => {
  const dp = C.minimaxTriangulation(n8, 0), bf = C.bruteForceMinimax(n8, 0);
  return { dp: dp.maxArea, brute: bf.maxArea, diff: Math.abs(dp.maxArea - bf.maxArea) };
})();
out.notes.push("fillAll6 = boundary-loop extraction + best-fit plane + DP + lift + audit for all six meshes");
out.notes.push("dp2000/brute200 run 2000/2000 repetitions per sample; per-polygon numbers divide the median");
out.notes.push("earClip30x500 runs the baseline over all 30 corpus polygons 500 times per sample");

writeFileSync("bench/result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
