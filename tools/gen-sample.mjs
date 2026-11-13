// Deterministic sample generator: 6 holey meshes + polygon corpus.
// Usage: node tools/gen-sample.mjs   (writes data/*.json, no randomness)
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { signedVolume, fillHoles, auditMesh } from "../src/core.mjs";

const out = (p, obj) => {
  mkdirSync("data", { recursive: true });
  writeFileSync(p, JSON.stringify(obj));
  return p;
};

const flipIfNegative = (mesh) => {
  if (signedVolume(mesh) < 0) mesh.triangles = mesh.triangles.map(([a, b, c]) => [a, c, b]);
  return mesh;
};

// ---------------------------------------------------------------- primitives
function box() {
  const positions = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const quads = [
    [0, 3, 2, 1], // bottom
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // front
    [3, 7, 6, 2], // back
    [0, 4, 7, 3], // left
    [1, 2, 6, 5], // right
  ];
  const triangles = [];
  for (const [a, b, c, d] of quads) triangles.push([a, b, c], [a, c, d]);
  return flipIfNegative({ positions, triangles });
}

function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  const positions = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(...p);
    return [p[0] / l, p[1] / l, p[2] / l];
  });
  let triangles = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + "_" + b : b + "_" + a;
      if (cache.has(k)) return cache.get(k);
      const A = positions[a], B = positions[b];
      const p = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      const l = Math.hypot(...p);
      positions.push([p[0] / l, p[1] / l, p[2] / l]);
      cache.set(k, positions.length - 1);
      return positions.length - 1;
    };
    const next = [];
    for (const [a, b, c] of triangles) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }
  return flipIfNegative({ positions, triangles });
}

function cylinder(radius, height, seg) {
  const positions = [];
  const triangles = [];
  const z0 = -height / 2, z1 = height / 2;
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    positions.push([radius * Math.cos(a), radius * Math.sin(a), z0]);
    positions.push([radius * Math.cos(a), radius * Math.sin(a), z1]);
  }
  const bot = positions.push([0, 0, z0]) - 1;
  const top = positions.push([0, 0, z1]) - 1;
  const bottomFaces = [], topFaces = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const b0 = 2 * i, t0 = 2 * i + 1, b1 = 2 * j, t1 = 2 * j + 1;
    triangles.push([b0, b1, t0], [b1, t1, t0]);
    topFaces.push([t0, t1, top], [t0, top, top]);
    bottomFaces.push([b1, b0, bot]);
  }
  const withCaps = flipIfNegative({ positions, triangles: triangles.concat(topFaces.filter(([a, b, c]) => !(a === top && b === top)), bottomFaces) });
  withCaps.topFaces = topFaces.filter(([a, b, c]) => !(a === top && b === top));
  return withCaps;
}

function torus(R, r, nu, nv) {
  const positions = [], triangles = [];
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    for (let j = 0; j < nv; j++) {
      const v = (2 * Math.PI * j) / nv;
      positions.push([
        (R + r * Math.cos(v)) * Math.cos(u),
        (R + r * Math.cos(v)) * Math.sin(u),
        r * Math.sin(v),
      ]);
    }
  }
  const id = (i, j) => ((i % nu) * nv) + (j % nv);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return flipIfNegative({ positions, triangles });
}

// ---------------------------------------------------------------- meshes
const meshes = [];
const cube = box();
const cubeHole = { name: "cube-one-hole", positions: cube.positions, triangles: cube.triangles.filter(([a, b, c]) => !(a >= 4 && b >= 4 && c >= 4)) };
meshes.push(cubeHole);

const sphere = icosphere(2);
const sphereHoles = {
  name: "sphere-two-holes",
  positions: sphere.positions,
  triangles: sphere.triangles.filter((_, i) => i !== 0 && i !== 160),
};
meshes.push(sphereHoles);

const cyl = cylinder(1, 2, 24);
const cylTop = new Set(cyl.topFaces.map((t) => t.join(",")));
const cylHole = {
  name: "cylinder-cap-hole",
  positions: cyl.positions,
  triangles: cyl.triangles.filter((t) => !cylTop.has(t.join(","))),
};
meshes.push(cylHole);

const tor = torus(1.2, 0.45, 24, 12);
// remove one 2x2 quad patch (4 quad = 8 triangles) -> one 8-gon hole
const removedQuads = new Set();
const torId = (i, j) => ((i % 24) * 12) + (j % 12);
for (const [i, j] of [[3, 3], [4, 3], [3, 4], [4, 4]]) removedQuads.add(torId(i, j));
const torHole = {
  name: "torus-patch-hole",
  positions: tor.positions,
  triangles: tor.triangles.filter((_, fi) => {
    const quad = Math.floor(fi / 2);
    const qi = Math.floor(quad / 12), qj = quad % 12;
    return !removedQuads.has(torId(qi, qj));
  }),
};
meshes.push(torHole);

const box2 = box();
const boxTop = new Set(["4,5,6", "4,6,7"]);
const boxBottom = new Set(["0,3,2", "0,2,1"]);
const box2Holes = {
  name: "box-two-holes",
  positions: box2.positions,
  triangles: box2.triangles.filter((t) => {
    const k = t.join(",");
    return !boxTop.has(k) && !boxBottom.has(k);
  }),
};
meshes.push(box2Holes);

const sphere2 = icosphere(2);
const incident = new Set();
sphere2.triangles.forEach((t, i) => { if (t.includes(0)) incident.add(i); });
const punctured = {
  name: "sphere-punctured-rim",
  positions: sphere2.positions,
  triangles: sphere2.triangles.filter((_, i) => !incident.has(i)),
};
meshes.push(punctured);

// ---------------------------------------------------------------- polygons
const polys = [];
const ellipse = (n, sx, sy, phase = 0) =>
  Array.from({ length: n }, (_, k) => {
    const a = phase + (2 * Math.PI * k) / n;
    return [sx * Math.cos(a), sy * Math.sin(a)];
  });
for (let n = 5; n <= 9; n++) {
  polys.push({ name: `convex-${n}-a`, points: ellipse(n, 1, 0.6), convex: true });
  polys.push({ name: `convex-${n}-b`, points: ellipse(n, 0.8, 1.4, 0.13), convex: true });
  polys.push({ name: `convex-${n}-c`, points: ellipse(n, 1.1, 0.9, 0.37), convex: true });
}
// non-convex star-shaped polygons (alternating radii) for the ear-clip baseline
for (const n of [10, 12, 14]) {
  const pts = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    const r = k % 2 === 0 ? 1 : 0.45;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  polys.push({ name: `star-${n}`, points: pts, convex: false });
}
// deterministic pseudo-random star-shaped polygons: ear clipping is not minimax here
let seed = 20261113;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let t = 0; t < 12; t++) {
  const n = 10 + (t % 5);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const r = 0.2 + rnd() * 1.0;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  polys.push({ name: `random-star-${n}-${t}`, points: pts, convex: false });
}

const meshFile = out("data/meshes.json", meshes);
const polyFile = out("data/polygons.json", polys);
// node-side reference numbers, so the browser can prove it runs the same core
const reference = {};
for (const m of meshes) {
  const before = auditMesh(m);
  const r = fillHoles(m);
  const after = auditMesh(r.mesh);
  reference[m.name] = {
    holes: r.loops,
    boundaryBefore: before.boundaryEdges,
    boundaryAfter: after.boundaryEdges,
    addedTriangles: r.fills.reduce((s, f) => s + (f.addedTriangles || 0), 0),
    volumeAfter: after.volume,
    closed: after.closed,
  };
}
out("data/reference.json", reference);

for (const f of [meshFile, polyFile]) {
  const buf = JSON.stringify(f === meshFile ? meshes : polys);
  console.log(f, buf.length, "bytes", "sha256", createHash("sha256").update(buf).digest("hex").slice(0, 16));
}
console.log("meshes", meshes.map((m) => `${m.name}:${m.triangles.length}`).join(" "));
console.log("polygons", polys.length);
