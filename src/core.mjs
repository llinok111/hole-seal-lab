// hole-seal-lab core: pure ES module, no three / DOM / I/O.
// Boundary-loop extraction, best-fit plane projection, exact minimum-area
// triangulation (DP) + ear-clipping baseline + brute-force enumerator,
// and a watertightness audit used both by bench and by the browser.
//
// Tolerances are RELATIVE to the mesh bounding-box diagonal:
//   tolDist = 1e-9 * diag, tolArea = 1e-9 * diag^2.
// No absolute epsilon is used anywhere (so scale changes do not flip results).

const DIST_REL = 1e-9;
const AREA_REL = 1e-9;

// ---------------------------------------------------------------- vectors
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);

function bboxDiag(positions, tris) {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const i of t) {
      const p = positions[i];
      for (let k = 0; k < 3; k++) {
        if (p[k] < mn[k]) mn[k] = p[k];
        if (p[k] > mx[k]) mx[k] = p[k];
      }
    }
  }
  return vlen(vsub(mx, mn));
}

function meshTol(mesh) {
  const diag = mesh.diag ?? bboxDiag(mesh.positions, mesh.triangles);
  return { diag, tolDist: DIST_REL * diag, tolArea: AREA_REL * diag * diag };
}

// ---------------------------------------------------------------- mesh audit
function edgeKey(a, b) {
  return a + "," + b;
}

/** directed edge -> number of faces using it */
export function directedEdgeCounts(mesh) {
  const m = new Map();
  for (const [a, b, c] of mesh.triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

/** boundary directed edges (used once, reverse never used) */
export function boundaryEdges(mesh) {
  const m = directedEdgeCounts(mesh);
  const out = [];
  for (const [k, n] of m) {
    if (n !== 1) continue;
    const [a, b] = k.split(",").map(Number);
    if (!m.has(edgeKey(b, a))) out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return out;
}

/** ordered boundary loops (vertex id arrays); each loop follows face winding */
export function boundaryLoops(mesh) {
  const be = boundaryEdges(mesh);
  const next = new Map();
  for (const [a, b] of be) {
    if (next.has(a)) {
      // non-manifold boundary vertex; keep deterministic first continuation
      if (next.get(a) > b) next.set(a, b);
    } else next.set(a, b);
  }
  const used = new Set();
  const loops = [];
  for (const [a, b] of be) {
    if (used.has(edgeKey(a, b))) continue;
    const loop = [a];
    used.add(edgeKey(a, b));
    let cur = b;
    let guard = 0;
    while (cur !== a && guard++ <= be.length) {
      loop.push(cur);
      const nxt = next.get(cur);
      if (nxt === undefined) break;
      const k = edgeKey(cur, nxt);
      if (used.has(k)) break;
      used.add(k);
      cur = nxt;
    }
    if (cur === a && loop.length >= 3) loops.push(loop);
  }
  loops.sort((x, y) => x.length - y.length || x[0] - y[0]);
  return loops;
}

function findRoot(parent, x) {
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)));
    x = parent.get(x);
  }
  return x;
}

/** signed volume via divergence theorem (positive for outward CCW winding) */
export function signedVolume(mesh) {
  let v = 0;
  const { positions, triangles } = mesh;
  for (const [a, b, c] of triangles) {
    const A = positions[a], B = positions[b], C = positions[c];
    v += (A[0] * (B[1] * C[2] - B[2] * C[1]) -
          A[1] * (B[0] * C[2] - B[2] * C[0]) +
          A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  return v;
}

export function surfaceArea(mesh) {
  let a = 0;
  const { positions, triangles } = mesh;
  for (const [i, j, k] of triangles) {
    const u = vsub(positions[j], positions[i]);
    const w = vsub(positions[k], positions[i]);
    a += vlen(vcross(u, w)) / 2;
  }
  return a;
}

/**
 * Watertightness audit.
 * closed = every undirected edge has exactly 2 faces, both traversals present once,
 *          no boundary edges, every vertex component has Euler characteristic 2.
 */
export function auditMesh(mesh) {
  const { positions, triangles } = mesh;
  const { diag, tolArea } = meshTol(mesh);
  const dir = directedEdgeCounts(mesh);
  let boundary = 0, windingConflict = 0, nonManifold = 0;
  for (const [k, n] of dir) {
    const [a, b] = k.split(",").map(Number);
    const rev = dir.get(edgeKey(b, a)) || 0;
    if (n > 1) nonManifold++;
    if (rev > 0 && n > 1) {
      // two faces traversing the same directed edge = inconsistent winding
      windingConflict++;
    }
    if (n === 1 && rev === 0) boundary++;
  }
  // per-component Euler characteristic over vertices touched by faces
  const parent = new Map();
  const verts = new Set();
  for (const t of triangles) for (const i of t) {
    verts.add(i);
    if (!parent.has(i)) parent.set(i, i);
  }
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ru = findRoot(parent, u), rv = findRoot(parent, v);
      if (ru !== rv) parent.set(ru, rv);
    }
  }
  const comps = new Map();
  for (const v of verts) {
    const r = findRoot(parent, v);
    if (!comps.has(r)) comps.set(r, { V: 0, F: 0, edges: new Set() });
    comps.get(r).V++;
  }
  for (const [a, b, c] of triangles) {
    const r = findRoot(parent, a);
    const c0 = comps.get(r);
    c0.F++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      c0.edges.add(u < v ? u + "_" + v : v + "_" + u);
    }
  }
  const euler = [];
  const genus = [];
  for (const c0 of comps.values()) {
    const e = c0.V - c0.edges.size + c0.F;
    euler.push(e);
    genus.push((2 - e) / 2);
  }
  euler.sort((x, y) => x - y);
  genus.sort((x, y) => x - y);
  const degenerate = triangles.filter(([a, b, c]) => {
    const u = vsub(positions[b], positions[a]);
    const w = vsub(positions[c], positions[a]);
    return vlen(vcross(u, w)) / 2 <= tolArea;
  }).length;
  return {
    triangles: triangles.length,
    vertices: verts.size,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    windingConflicts: windingConflict,
    components: comps.size,
    euler,
    genus,
    degenerateFaces: degenerate,
    closed: boundary === 0 && nonManifold === 0 && windingConflict === 0 && degenerate === 0,
    volume: signedVolume(mesh),
    area: surfaceArea(mesh),
    diag,
  };
}

// ---------------------------------------------------------------- plane / polygon
export function newellNormal(points) {
  let n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = vlen(n);
  return l === 0 ? [0, 0, 1] : vmul(n, 1 / l);
}

export function fitPlane(points) {
  const origin = vmul(points.reduce((s, p) => vadd(s, p), [0, 0, 0]), 1 / points.length);
  const normal = newellNormal(points);
  let u = vsub(points[0], origin);
  u = vsub(u, vmul(normal, vdot(u, normal)));
  let ul = vlen(u);
  if (ul < 1e-300) {
    u = Math.abs(normal[0]) < 0.9 ? vcross(normal, [1, 0, 0]) : vcross(normal, [0, 1, 0]);
    ul = vlen(u);
  }
  u = vmul(u, 1 / ul);
  const v = vcross(normal, u);
  return { origin, normal, u, v };
}

export function projectToPlane(points, plane) {
  return points.map((p) => {
    const d = vsub(p, plane.origin);
    return [vdot(d, plane.u), vdot(d, plane.v)];
  });
}

export function signedArea2D(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1])) {
      const x = a[0] + ((pt[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (pt[0] < x) inside = !inside;
    }
  }
  return inside;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p, eps) {
  return Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps &&
         Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps &&
         Math.abs(orient(a, b, p)) <= eps * (Math.hypot(b[0] - a[0], b[1] - a[1]) + 1);
}

/** true if segments ab and cd intersect anywhere (including endpoints) */
export function segmentsIntersect(a, b, c, d, eps = 0) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
      ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  if (onSegment(a, b, c, eps)) return true;
  if (onSegment(a, b, d, eps)) return true;
  if (onSegment(c, d, a, eps)) return true;
  if (onSegment(c, d, b, eps)) return true;
  return false;
}

/** true if the closed polygon has no crossing / touching non-adjacent edges */
export function polygonIsSimple(poly, eps = 0) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n], eps)) return false;
    }
  }
  return true;
}

/** proper intersection only (shared endpoints do not count) */
function properlyIntersects(a, b, c, d, eps) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
         ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
}

/**
 * A diagonal i-j of a CCW simple polygon is usable iff it does not properly
 * cross any non-incident edge and its midpoint is inside the polygon.
 */
export function diagonalValid(poly, i, j, eps) {
  const n = poly.length;
  const a = poly[i], b = poly[j];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    if (k === i || k2 === i || k === j || k2 === j) continue;
    if (properlyIntersects(a, b, poly[k], poly[k2], eps)) return false;
  }
  return pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], poly);
}

const triArea2D = (poly, i, j, k) =>
  Math.abs(orient(poly[i], poly[j], poly[k])) / 2;

/**
 * Exact minimax-area triangulation of a simple polygon by interval DP:
 * minimise the LARGEST triangle area (sum of areas is constant for every
 * valid triangulation, so a sum objective would be degenerate).
 * Only valid diagonals are considered, so the result is a valid
 * non-overlapping triangulation for non-convex polygons too.
 * Returns indices into the input polygon.
 */
export function minimaxTriangulation(poly, eps = 0) {
  const n = poly.length;
  if (n < 3) return { indices: [], maxArea: 0, valid: n === 0, diagonals: 0 };
  // make CCW
  let pts = poly;
  let flip = false;
  if (signedArea2D(poly) < 0) {
    pts = poly.slice().reverse();
    flip = true;
  }
  // edge (i,i+1) always usable; store dp over chains
  const dp = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  const pick = Array.from({ length: n }, () => new Int32Array(n).fill(-1));
  for (let i = 0; i < n - 1; i++) dp[i][i + 1] = 0;
  const usable = (i, j) => {
    if (j === i + 1 || (i === 0 && j === n - 1)) return true;
    return diagonalValid(pts, i, j, eps);
  };
  for (let span = 2; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const j = i + span;
      for (let k = i + 1; k < j; k++) {
        if (!usable(i, k) || !usable(k, j)) continue;
        const cand = Math.max(dp[i][k], dp[k][j], triArea2D(pts, i, k, j));
        if (cand < dp[i][j]) {
          dp[i][j] = cand;
          pick[i][j] = k;
        }
      }
    }
  }
  if (!isFinite(dp[0][n - 1])) return { indices: [], maxArea: Infinity, valid: false, diagonals: 0 };
  const tris = [];
  const walk = (i, j) => {
    if (j <= i + 1) return;
    const k = pick[i][j];
    if (k < 0) return;
    tris.push([i, k, j]);
    walk(i, k);
    walk(k, j);
  };
  walk(0, n - 1);
  const mapIdx = (i) => (flip ? n - 1 - i : i);
  const indices = tris.map((t) => t.map(mapIdx));
  const maxArea = tris.reduce((mx, [i, k, j]) => Math.max(mx, triArea2D(pts, i, k, j)), 0);
  return { indices, maxArea, valid: true, diagonals: tris.length };
}

/** ear-clipping baseline (no area optimisation) */
export function earClip(poly) {
  const n = poly.length;
  let pts = poly;
  let flip = false;
  if (signedArea2D(poly) < 0) {
    pts = poly.slice().reverse();
    flip = true;
  }
  const idx = [...Array(n).keys()];
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let t = 0; t < idx.length; t++) {
      const i0 = idx[(t + idx.length - 1) % idx.length];
      const i1 = idx[t];
      const i2 = idx[(t + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (orient(a, b, c) <= 0) continue;
      let contains = false;
      for (const q of idx) {
        if (q === i0 || q === i1 || q === i2) continue;
        if (pointInPolygon(pts[q], [a, b, c])) { contains = true; break; }
      }
      if (contains) continue;
      out.push([i0, i1, i2]);
      idx.splice(t, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  const mapIdx = (i) => (flip ? n - 1 - i : i);
  let area = 0, maxArea = 0;
  for (const t of out) {
    const a = triArea2D(pts, ...t);
    area += a;
    if (a > maxArea) maxArea = a;
  }
  return { indices: out.map((t) => t.map(mapIdx)), area, maxArea, valid: out.length === n - 2 };
}

/** all triangulations of an n-gon (Catalan(n-2)), each exactly once */
export function enumerateTriangulations(n) {
  const memo = new Map();
  const rec = (i, j) => {
    if (j - i < 2) return [[]];
    const key = i + "," + j;
    if (memo.has(key)) return memo.get(key);
    const res = [];
    for (let k = i + 1; k < j; k++) {
      for (const L of rec(i, k)) {
        for (const R of rec(k, j)) res.push([...L, ...R, [i, k, j]]);
      }
    }
    memo.set(key, res);
    return res;
  };
  return rec(0, n - 1);
}

/** brute-force MINIMAX area over every triangulation (validity-filtered) */
export function bruteForceMinimax(poly, eps = 0) {
  const n = poly.length;
  const nTris = n - 2;
  const all = enumerateTriangulations(n);
  let best = Infinity;
  let count = 0;
  for (const tris of all) {
    if (tris.length !== nTris) continue;
    let area = 0, maxA = 0, ok = true;
    for (const [i, j, k] of tris) {
      const a = triArea2D(poly, i, j, k);
      if (!(a > eps)) { ok = false; break; }
      area += a;
      if (a > maxA) maxA = a;
    }
    if (!ok) continue;
    // total area must equal the polygon area (rules out overlaps/holes)
    if (Math.abs(area - Math.abs(signedArea2D(poly))) > Math.max(eps, 1e-9 * Math.abs(signedArea2D(poly)))) continue;
    count++;
    if (maxA < best) best = maxA;
  }
  return { maxArea: best, validCount: count, total: all.length };
}

/** check that a triangulation is a valid non-overlapping cover of the polygon */
export function validateTriangulation(poly, indices) {
  const n = poly.length;
  const polyArea = Math.abs(signedArea2D(poly));
  let sum = 0, positive = true, maxTriangleArea = 0;
  for (const [i, j, k] of indices) {
    const a = triArea2D(poly, i, j, k);
    if (!(a > 0)) positive = false;
    sum += a;
    if (a > maxTriangleArea) maxTriangleArea = a;
  }
  // pairwise overlap: any two triangles sharing no vertex may not cross
  let overlaps = 0;
  for (let x = 0; x < indices.length; x++) {
    for (let y = x + 1; y < indices.length; y++) {
      const A = indices[x], B = indices[y];
      const shared = A.filter((v) => B.includes(v)).length;
      name: if (shared === 0) {
        for (let e1 = 0; e1 < 3; e1++) {
          for (let e2 = 0; e2 < 3; e2++) {
            const a = poly[A[e1]], b = poly[A[(e1 + 1) % 3]];
            const c = poly[B[e2]], d = poly[B[(e2 + 1) % 3]];
            if (properlyIntersects(a, b, c, d, 0)) { overlaps++; break name; }
          }
        }
      } else if (shared === 1) {
        // triangles sharing one vertex could still overlap; check centroid containment
        const cA = centroid2D(A.map((v) => poly[v]));
        if (pointInPolygon(cA, B.map((v) => poly[v]))) overlaps++;
      }
    }
  }
  return {
    triangleCount: indices.length,
    expected: n - 2,
    positive,
    areaSum: sum,
    polygonArea: polyArea,
    maxTriangleArea,
    areaError: Math.abs(sum - polyArea),
    overlaps,
    valid: positive && indices.length === n - 2 && overlaps === 0 &&
      Math.abs(sum - polyArea) <= 1e-9 * polyArea,
  };
}

function centroid2D(pts) {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length,
          pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function triArea3D(A, B, C) {
  return vlen(vcross(vsub(B, A), vsub(C, A))) / 2;
}

// ---------------------------------------------------------------- fill
/**
 * Fill every boundary loop of `mesh`.
 * Strategy: best-fit plane -> project -> exact min-area DP triangulation ->
 * lift back -> orient new faces so each boundary edge is reversed exactly once.
 * Returns a NEW mesh plus per-hole evidence and before/after audits.
 */
export function fillHoles(mesh, opts = {}) {
  const { positions, triangles } = mesh;
  const { diag, tolDist, tolArea } = meshTol(mesh);
  const eps2d = tolDist;
  const loops = boundaryLoops(mesh);
  const before = auditMesh(mesh);
  const required = new Set();
  for (const [a, b] of boundaryEdges(mesh)) required.add(edgeKey(b, a));
  const newTris = triangles.map((t) => t.slice());
  const fills = [];
  for (const loop of loops) {
    const pts3 = loop.map((i) => positions[i]);
    const plane = fitPlane(pts3);
    const poly2 = projectToPlane(pts3, plane);
    const polyArea = Math.abs(signedArea2D(poly2));
    const simple = polygonIsSimple(poly2, eps2d);
    if (!simple) { fills.push({ loop, rimVertices: loop.length, skipped: "projection-not-simple" }); continue; }
    if (!(polyArea > tolArea)) { fills.push({ loop, rimVertices: loop.length, skipped: "degenerate-projection" }); continue; }
    const dp = minimaxTriangulation(poly2, eps2d);
    const ear = earClip(poly2);
    const val = validateTriangulation(poly2, dp.indices);
    let used = "dp";
    let idx = dp.indices;
    if (!val.valid || dp.indices.length !== loop.length - 2) {
      used = "earclip-fallback";
      idx = ear.indices;
    }
    // lift
    let tris = idx.map(([i, j, k]) => [loop[i], loop[j], loop[k]]);
    // orientation: new faces must reverse the existing boundary directed edges
    let match = 0, mismatch = 0;
    for (const [a, b, c] of tris) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (required.has(edgeKey(u, v))) match++;
        else if (required.has(edgeKey(v, u))) mismatch++;
      }
    }
    if (mismatch > match) tris = tris.map(([a, b, c]) => [a, c, b]);
    for (const t of tris) newTris.push(t);
    const liftArea = tris.reduce((s, [a, b, c]) => s + triArea3D(positions[a], positions[b], positions[c]), 0);
    // non-planarity: max |distance to best-fit plane| over the rim
    let maxRimDev = 0;
    for (const p of pts3) maxRimDev = Math.max(maxRimDev, Math.abs(vdot(vsub(p, plane.origin), plane.normal)));
    fills.push({
      loop,
      simple: true,
      rimVertices: loop.length,
      planeNormal: plane.normal,
      planeArea: polyArea,
      minimaxArea: dp.maxArea,
      earMaxArea: ear.maxArea,
      earOverMinimax: dp.maxArea > 0 ? ear.maxArea / dp.maxArea - 1 : 0,
      planarityDeviation: maxRimDev,
      deviationRatio: diag > 0 ? maxRimDev / diag : 0,
      addedTriangles: tris.length,
      addedArea3D: liftArea,
      used,
      validity: val,
      dpValid: dp.valid,
    });
  }
  const after = { ...mesh, triangles: newTris };
  const audit = auditMesh(after);
  return { mesh: after, fills, before, after: audit, loops: loops.length, diag };
}

/** independent re-check of a fill result: was every hole actually closed? */
export function verifyFill(beforeMesh, fillResult) {
  const before = auditMesh(beforeMesh);
  const after = auditMesh(fillResult.mesh);
  const accounted = fillResult.fills.reduce(
    (s, f) => s + (f.addedTriangles || 0), 0);
  return {
    boundaryBefore: before.boundaryEdges,
    boundaryAfter: after.boundaryEdges,
    closedAfter: after.closed,
    windingAfter: after.windingConflicts,
    nonManifoldAfter: after.nonManifoldEdges,
    degenerateAfter: after.degenerateFaces,
    addedTriangles: accounted,
    triangleDelta: fillResult.mesh.triangles.length - beforeMesh.triangles.length,
    volumeBefore: before.volume,
    volumeAfter: after.volume,
    volumeDelta: after.volume - before.volume,
    ok: after.boundaryEdges === 0 && after.closed &&
        accounted === fillResult.mesh.triangles.length - beforeMesh.triangles.length,
  };
}

export function scaleMesh(mesh, s) {
  return {
    ...mesh,
    positions: mesh.positions.map((p) => [p[0] * s, p[1] * s, p[2] * s]),
    diag: undefined,
  };
}
