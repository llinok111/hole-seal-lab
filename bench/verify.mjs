// Assertions with printed actual values. Exit 0 iff every assertion holds.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as C from "../src/core.mjs";

const meshes = JSON.parse(readFileSync("data/meshes.json"));
const polys = JSON.parse(readFileSync("data/polygons.json"));
let pass = 0, fail = 0;
const ok = (cond, label, actual) => {
  if (cond) { pass++; console.log(`  PASS ${label}  [${actual}]`); }
  else { fail++; console.log(`  FAIL ${label}  [${actual}]`); }
};

// ---- 1. generator determinism -------------------------------------------
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const s1 = [sha("data/meshes.json"), sha("data/polygons.json")];
execFileSync("node", ["tools/gen-sample.mjs"], { stdio: "ignore" });
const s2 = [sha("data/meshes.json"), sha("data/polygons.json")];
ok(s1[0] === s2[0] && s1[1] === s2[1], "generator deterministic (2 runs, sha256)", s1.map((x) => x.slice(0, 12)).join("/"));

// ---- 2. hole detection / fill / watertight certificate ------------------
let totalHoles = 0, totalBoundaryBefore = 0, totalBoundaryAfter = 0, allClosed = true, skipped = 0;
let totalAdded = 0;
for (const m of meshes) {
  const before = C.auditMesh(m);
  const r = C.fillHoles(m);
  const v = C.verifyFill(m, r);
  totalHoles += r.loops;
  totalBoundaryBefore += before.boundaryEdges;
  totalBoundaryAfter += v.boundaryAfter;
  allClosed = allClosed && v.closedAfter;
  totalAdded += v.addedTriangles;
  skipped += r.fills.filter((f) => f.skipped).length;
  console.log(`  ${m.name}: ${m.triangles.length} tris, loops=${r.loops}, boundary ${before.boundaryEdges}->${v.boundaryAfter}, closed=${v.closedAfter}, +${v.addedTriangles} tris, vol ${before.volume.toFixed(4)}->${v.volumeAfter.toFixed(4)}`);
  ok(v.ok && v.boundaryAfter === 0 && v.closedAfter, `${m.name} watertight after fill`, `bnd=${v.boundaryAfter},closed=${v.closedAfter}`);
  ok(v.addedTriangles === r.fills.reduce((s, f) => s + f.rimVertices - 2, 0), `${m.name} added tris = sum(rim-2)`, v.addedTriangles);
}
ok(meshes.length === 6, "corpus has 6 holey meshes", meshes.length);
ok(totalHoles === 8, "8 holes detected in total", totalHoles);
ok(totalBoundaryBefore === 55, "55 boundary edges before repair", totalBoundaryBefore);
ok(totalBoundaryAfter === 0, "0 boundary edges after repair", totalBoundaryAfter);
ok(allClosed, "all 6 meshes closed after repair", allClosed);
ok(skipped === 0, "0 holes skipped / refused", skipped);

// ---- 3. exactness of the DP against brute-force enumeration -------------
const convex = polys.filter((p) => p.convex);
let bruteEq = 0;
for (const p of convex) {
  const dp = C.minimaxTriangulation(p.points, 0);
  const bf = C.bruteForceMinimax(p.points, 0);
  if (Math.abs(dp.maxArea - bf.maxArea) <= 1e-12 * Math.max(1, bf.maxArea)) bruteEq++;
}
ok(bruteEq === convex.length, `DP == brute-force minimax on ${convex.length} convex polygons`, `${bruteEq}/${convex.length}`);
const cat = [5, 6, 7, 8, 9].map((n) => C.enumerateTriangulations(n).length);
ok(cat.join(",") === "5,14,42,132,429", "enumeration counts = Catalan(3..7)", cat.join(","));

// non-convex n=8 polygons: exhaustive validity-filtered brute force
let seed = 999;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let ncEq = 0, ncN = 6, ncValid = 0;
for (let t = 0; t < ncN; t++) {
  const pts = Array.from({ length: 8 }, (_, k) => {
    const a = (2 * Math.PI * k) / 8, r = 0.2 + rnd() * 1.0;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const dp = C.minimaxTriangulation(pts, 0);
  const bf = C.bruteForceMinimax(pts, 0);
  const val = C.validateTriangulation(pts, dp.indices);
  if (val.valid) ncValid++;
  if (Math.abs(dp.maxArea - bf.maxArea) <= 1e-12) ncEq++;
}
ok(ncEq === ncN, `DP == brute-force minimax on ${ncN} non-convex polygons`, `${ncEq}/${ncN}`);
ok(ncValid === ncN, "DP triangulations valid (no overlap) on non-convex", `${ncValid}/${ncN}`);

// ---- 4. ear clipping baseline is not minimax ---------------------------
let earWorse = 0, worst = 0;
for (const p of polys) {
  const dp = C.minimaxTriangulation(p.points, 0);
  const ear = C.earClip(p.points);
  const val = C.validateTriangulation(p.points, dp.indices);
  if (!val.valid) { console.log(`  INVALID DP on ${p.name}`); }
  if (ear.maxArea > dp.maxArea * (1 + 1e-9)) {
    earWorse++;
    worst = Math.max(worst, ear.maxArea / dp.maxArea);
  }
}
ok(earWorse >= 10, "ear clipping is suboptimal on >=10 corpus polygons", `${earWorse}/${polys.length}, worst ${worst.toFixed(3)}x`);
ok(worst > 1.5, "worst ear-clip penalty > 1.5x", `${worst.toFixed(3)}x`);
let allValid = 0;
for (const p of polys) {
  if (C.validateTriangulation(p.points, C.minimaxTriangulation(p.points, 0).indices).valid) allValid++;
}
ok(allValid === polys.length, `all ${polys.length} DP triangulations non-overlapping`, `${allValid}/${polys.length}`);

// ---- 5. volumes restored ------------------------------------------------
const cube = meshes.find((m) => m.name === "cube-one-hole");
const cubeFill = C.fillHoles(cube);
const cubeAfter = C.auditMesh(cubeFill.mesh);
ok(Math.abs(cubeAfter.volume - 8) < 1e-12, "cube volume exactly 8 after fill", cubeAfter.volume.toPrecision(15));
ok(Math.abs(cubeAfter.volume - C.auditMesh(cube).volume - 4 / 3) < 1e-12, "cube volume delta = 1.3333 (top cap)", (cubeAfter.volume - C.auditMesh(cube).volume).toPrecision(15));
const cyl = meshes.find((m) => m.name === "cylinder-cap-hole");
const cylAfter = C.auditMesh(C.fillHoles(cyl).mesh);
const cylErr = Math.abs(cylAfter.volume - Math.PI * 2) / (Math.PI * 2);
ok(cylErr < 0.02, "cylinder volume within 2% of analytic pi*2", `${(cylErr * 100).toFixed(3)}%`);

// ---- 6. scale invariance (1e-6 .. 1e6) ---------------------------------
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
let scaleOk = 0;
for (const s of scales) {
  const m = C.scaleMesh(cube, s);
  const r = C.fillHoles(m);
  const v = C.verifyFill(m, r);
  const vol = C.auditMesh(r.mesh).volume;
  if (v.boundaryAfter === 0 && v.closedAfter && r.loops === 1 &&
      Math.abs(vol - 8 * s * s * s) <= 1e-9 * Math.abs(8 * s * s * s) &&
      r.fills[0].rimVertices === 4) scaleOk++;
  console.log(`  scale ${s}: loops=${r.loops} bnd->${v.boundaryAfter} closed=${v.closedAfter} vol=${vol.toExponential(6)}`);
}
ok(scaleOk === scales.length, "scale invariance 1e-6..1e6 (same loop, closed, volume ~ s^3)", `${scaleOk}/${scales.length}`);

// ---- 7. rotation invariance -------------------------------------------
const rot = (p) => [0.36 * p[0] - 0.48 * p[1] + 0.8 * p[2], 0.8 * p[0] + 0.6 * p[1], -0.48 * p[0] + 0.64 * p[1] + 0.6 * p[2]];
const rotated = { ...cube, positions: cube.positions.map(rot), diag: undefined };
const rotR = C.fillHoles(rotated);
ok(rotR.loops === 1 && C.verifyFill(rotated, rotR).closedAfter, "rotation invariance: 1 loop, closed", `loops=${rotR.loops}`);
ok(rotR.fills[0].rimVertices === 4, "rotation invariance: rim stays 4-gon", rotR.fills[0].rimVertices);

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
