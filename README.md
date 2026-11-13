# hole-seal-lab

**Seal every boundary loop of a triangle mesh with the exact minimax-area triangulation, and prove it: 8/8 holes in 6 meshes go from 55 boundary edges to 0 and pass a closed-manifold certificate; the DP result equals the exhaustive optimum on 21/21 test polygons (15 convex + 6 non-convex), while the ear-clipping baseline used by common fillers is up to 2.005× worse in worst-triangle area.**

"Minimax" = minimise the **largest** triangle area. Sum of triangle areas is identical for every valid triangulation of a polygon, so a sum objective would be degenerate — the meaningful quality target is the worst triangle.

Upstream: none

**Evidence in one line:** 55 → 0 boundary edges, 8/8 holes sealed and closed, DP == exhaustive optimum 21/21, 32/32 assertions, `bench/result.json` in-repo.

## Run it (one command each)

```bash
node tools/gen-sample.mjs        # deterministic data/ (meshes, polygons, node reference)
node bench/verify.mjs            # 32 assertions, exit 0, prints every actual value
node bench/bench.mjs             # writes bench/result.json (warmup 1 + 9 samples)
python3 -m http.server 4173      # then open http://localhost:4173
```

The page loads `data/meshes.json`, draws the open mesh with its boundary edges in red, and a **Seal holes** button runs the *same* `src/core.mjs` in the browser. The HUD compares every number it computes with the node-baked `data/reference.json` and prints `MATCHES` / `MISMATCH` — what you see is what node verified.

No build step, no `node_modules`. three.js r169 is pinned in the import map; the page needs network access to jsDelivr only.

## What it does

1. `boundaryLoops(mesh)` — directed-edge table → ordered boundary loops (the holes).
2. `fitPlane(loop)` + projection → a 2D polygon; **refuses** the hole if the projection is not a simple polygon (`projection-not-simple`) instead of emitting a self-overlapping fill.
3. `minimaxTriangulation(poly)` — interval DP, O(n³), restricted to diagonals that stay inside the polygon (`diagonalValid`), so non-convex rims are handled; returns the triangulation and its worst triangle.
4. Lift the 2D triangles back, orient them by reversing each existing boundary directed edge exactly once, append.
5. `auditMesh` after the fill — per undirected edge exactly two faces, no boundary, no same-direction duplicate, Euler characteristic reported (a torus correctly reports χ=0, not 2), signed volume, degenerate faces.

`earClip()` is the in-repo baseline (greedy first-ear). `enumerateTriangulations()` / `bruteForceMinimax()` are the independent oracle: enumerate all Catalan(n−2) triangulations, discard invalid ones (positive areas, total area equals polygon area), take the minimum worst triangle.

## Evidence (real runs, `bench/result.json`)

Corpus: 6 meshes / 8 holes (cube lid, two sphere triangle holes, 24-gon cylinder cap, 8-gon torus patch, two box lids, 5-gon non-planar punctured sphere rim).

| Check | Result |
| --- | --- |
| boundary edges before → after | **55 → 0** |
| meshes closed after fill (every edge 2 faces, consistent winding) | **6/6** |
| holes sealed / refused | **8 / 0** |
| added triangles = Σ(rim−2) | 39 = 39 |
| cube volume after fill | **8.00000000000000** (open mesh: 6.6667) |
| cylinder volume error vs analytic π·2 | **1.138%** (mesh discretisation) |
| DP == brute-force minimax, convex polygons n=5..9 | **15/15** (429 enumerations at n=9) |
| DP == brute-force minimax, non-convex n=8 | **6/6** |
| enumeration counts n=5..9 | 5, 14, 42, 132, 429 = Catalan(3..7) |
| valid (non-overlapping) DP triangulations | **30/30** |
| ear clip worse than DP | **12/30 polygons, worst 2.005×** |
| scale 1e-6, 1e-3, 1, 1e3, 1e6 | **5/5** same loop count, closed, volume = 8·s³ within 1e-9 relative |
| rotation | 1 loop, rim stays a 4-gon, closed |
| `node bench/verify.mjs` | **32 passed / 0 failed**, exit 0 |

Timings (Node v24.19.0, 4 cores / 3.6 GB, 9 samples after 1 warmup; cold start = first call in the process):

| Workload | cold | median | min | p95 | RSD |
| --- | --- | --- | --- | --- | --- |
| fill all 6 meshes (8 holes) | 44.32 ms | **25.63 ms** | 17.06 ms | 33.97 ms | 23.5% |
| torus patch, 568 tris | 8.64 ms | **6.55 ms** | 6.29 ms | 9.56 ms | 15.5% |
| sphere, 318 tris, 2 holes | 4.12 ms | **4.00 ms** | 3.88 ms | 5.81 ms | 15.2% |
| cylinder cap, 24-gon rim | 2.49 ms | **2.63 ms** | 2.32 ms | 3.66 ms | 13.3% |
| punctured sphere, 5-gon rim | 3.43 ms | **3.54 ms** | 3.36 ms | 3.75 ms | 3.4% |
| cube lid, 4-gon rim | 0.20 ms | **0.14 ms** | 0.13 ms | 0.40 ms | 46.9% |
| DP, 2000 repeats | 0.15 ms | **26.29 ms** (13.1 µs/polygon) | 26.11 ms | 43.77 ms | 19.1% |
| brute force, 2000 repeats | 0.89 ms | **109.67 ms** (54.8 µs/polygon) | 103.77 ms | 130.58 ms | 8.3% |
| ear clipping, 30 polys × 500 | 1.18 ms | **34.70 ms** (2.3 µs/polygon) | 34.38 ms | 60.22 ms | 21.4% |

**The DP is 4.17× faster than exhaustive enumeration and returns the identical worst-area value** (0.4658795710601196 both, diff 0). Ear clipping is ~5.7× faster per polygon but is not optimal; that is the trade-off this tool makes explicit.

**RSD caveat (honest):** the 4-core host is shared and several workloads run for tens of microseconds, so RSD is above 10% for the sub-millisecond rows and for the all-meshes row. Values are medians of 9 samples with the p95 and min also published; treat cross-run absolute differences under ~30% as noise. The correctness numbers do not depend on timing.

## 本轮创新

**B 档：把「填孔」从几何猜测变成可复算的最优性 + 水密性双证书。** 公开的填孔实现里，trimesh `fill_holes` 是扇形/耳切（其文档自认非凸孔会出错），CGAL PMP `triangulate_hole()` 用 DP 但权重混合面积与二面角、且不提供最优性证据；DP 本身是 Klincsek 1980 的教科书算法，**不是**本轮的发明。本轮的差别是：每个孔的最差三角形面积都对着**全枚举暴力 oracle**逐值核对（21/21 相等），DP 的剖分再经非重叠校验，修补后给出逐边的闭合/绕序/欧拉数/体积证书，并且在投影自交时**显式拒绝**而不是输出错面片。浏览器与 node 共用同一 core，HUD 与 `data/reference.json` 逐项比对。

## Known limitations

- **CGAL overlap, disclosed:** CGAL's `triangulate_hole()` also runs a DP over the rim. This project does not claim to invent DP hole filling; its claim is the exhaustive optimality check and the post-fill certificate, plus the explicit refusal path.
- **Non-planar rims:** the fill is computed in the best-fit plane and lifted; rim non-planarity is reported per hole (`planarityDeviation`, `deviationRatio`) but not bounded in the 3D triangulation. A highly non-planar rim can produce a folded cap even though the 2D triangulation is valid. All 8 corpus holes are mild; this is not a proof for arbitrary rims.
- **Minimax area is a quality proxy, not a guarantee:** it bounds the worst triangle *area*; it does not prevent skinny triangles, control dihedral angles, or preserve sharp features. CGAL's area+dihedral weight is better for surface quality.
- **Projection refusal:** if the rim projects to a self-intersecting polygon the hole is skipped (`projection-not-simple`) and the mesh is not claimed closed. The 6-mesh corpus has 0 refusals; adversarial rims are untested beyond this check.
- **Relative tolerances only:** `tolDist = 1e-9·bboxDiag`, `tolArea = 1e-9·bboxDiag²`. Scale behaviour was tested from 1e-6 to 1e6 (5/5 invariant); below that, double-precision cancellation in the plane fit and orientation predicates is not characterised. There is no absolute epsilon.
- **No attribute handling:** positions only — UVs, normals, colours and skin weights are not interpolated on new triangles, and no hole-boundary smoothing / fairing is applied.
- **Closed test is topological:** `closed` means every edge has exactly two opposite traversals; it does not prove the surface is embedded (self-intersection after filling is not checked).
- **Browser verification is static only:** the page was served with `python3 -m http.server` (HTTP 200, import map present) and the core is imported unmodified, but no GPU/browser interaction was executed in this headless environment.

## License

MIT — see `LICENSE`.
