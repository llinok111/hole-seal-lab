// Renderer/interaction only: every number shown comes from src/core.mjs,
// the same module bench/verify.mjs executes in node.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { auditMesh, boundaryEdges, fillHoles } from "./src/core.mjs";

const [meshes, reference] = await Promise.all([
  fetch("./data/meshes.json").then((r) => r.json()),
  fetch("./data/reference.json").then((r) => r.json()),
]);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
camera.position.set(3.2, 2.4, 3.2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x66aaff, 1.0);
rim.position.set(-5, -2, -4);
scene.add(rim);

let group = new THREE.Group();
scene.add(group);
let sealed = false;
let current = null;

const meshSel = document.getElementById("mesh");
const toggle = document.getElementById("toggle");
const out = document.getElementById("out");
const cert = document.getElementById("cert");

for (const m of meshes) {
  const o = document.createElement("option");
  o.value = m.name;
  o.textContent = `${m.name} (${m.triangles.length} tris)`;
  meshSel.appendChild(o);
}

const makeGeometry = (mesh, triangles) => {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(triangles.length * 9);
  let k = 0;
  for (const [a, b, c] of triangles) {
    for (const i of [a, b, c]) {
      const p = mesh.positions[i];
      pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2];
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
};

const makeBoundaryLines = (mesh) => {
  const edges = boundaryEdges(mesh);
  const pos = new Float32Array(edges.length * 6);
  let k = 0;
  for (const [a, b] of edges) {
    for (const i of [a, b]) {
      const p = mesh.positions[i];
      pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff5c5c }));
};

const disposeGroup = () => {
  for (const child of group.children) {
    child.geometry?.dispose();
    child.material?.dispose();
  }
  group.clear();
};

function render() {
  disposeGroup();
  const src = meshes.find((m) => m.name === current);
  const result = sealed ? fillHoles(src) : null;
  const shown = result ? result.mesh : src;
  const geo = makeGeometry(shown, shown.triangles);
  const mat = new THREE.MeshStandardMaterial({
    color: sealed ? 0x66c2ff : 0xb8c4d4, metalness: 0.15, roughness: 0.55,
    flatShading: true, side: THREE.DoubleSide, wireframe: false,
  });
  group.add(new THREE.Mesh(geo, mat));
  if (!sealed) group.add(makeBoundaryLines(src));

  const before = auditMesh(src);
  const after = result ? auditMesh(result.mesh) : before;
  const ref = reference[current];
  const match = result
    ? result.loops === ref.holes && after.boundaryEdges === ref.boundaryAfter &&
      after.closed === ref.closed && Math.abs(after.volume - ref.volumeAfter) <= 1e-9 * Math.abs(ref.volumeAfter)
    : before.boundaryEdges === ref.boundaryBefore;

  const fills = result ? result.fills : [];
  const gaps = fills.map((f) => f.earOverMinimax).filter((x) => Number.isFinite(x));
  const worstGap = gaps.length ? Math.max(...gaps) : 0;
  out.innerHTML = `
    <span>boundary edges</span><b>${before.boundaryEdges} &rarr; ${after.boundaryEdges}</b>
    <span>closed</span><b class="${after.closed ? "ok" : "bad"}">${after.closed}</b>
    <span>holes</span><b>${before.boundaryEdges ? (result ? result.loops : "?") : 0}</b>
    <span>added triangles</span><b>${result ? fills.reduce((s, f) => s + (f.addedTriangles || 0), 0) : 0}</b>
    <span>volume</span><b>${before.volume.toFixed(4)} &rarr; ${after.volume.toFixed(4)}</b>
    <span>worst ear/DP</span><b>${(worstGap * 100).toFixed(2)}%</b>
    <span>euler</span><b>[${after.euler.join(", ")}]</b>
  `;
  cert.className = match ? "ok" : "bad";
  cert.textContent = result
    ? `node reference ${match ? "MATCHES" : "MISMATCH"}: holes=${ref.holes}, bnd=${ref.boundaryAfter}, closed=${ref.closed}, vol=${ref.volumeAfter.toFixed(4)}`
    : `node reference (open mesh): bnd=${ref.boundaryBefore}, holes=${ref.holes}`;
}

meshSel.addEventListener("change", () => { current = meshSel.value; sealed = false; toggle.classList.remove("active"); toggle.textContent = "Seal holes"; render(); });
toggle.addEventListener("click", () => {
  const src = meshes.find((m) => m.name === current);
  if (!sealed && auditMesh(src).boundaryEdges === 0) return;
  sealed = !sealed;
  toggle.classList.toggle("active", sealed);
  toggle.textContent = sealed ? "Show open mesh" : "Seal holes";
  render();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

current = meshes[0].name;
render();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
