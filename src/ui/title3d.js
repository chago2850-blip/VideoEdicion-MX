/* MontajeMX — títulos 3D extruidos (three.js): geometría real con bisel, luces, materiales y animación.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
import * as THREE from '/vendor/three/three.module.js';
import { FontLoader } from '/vendor/three/FontLoader.js';
import { TextGeometry } from '/vendor/three/TextGeometry.js';
import { RoomEnvironment } from '/vendor/three/RoomEnvironment.js';

let renderer = null, scene, camera, key, failed = false;
const fonts = new Map(), pending = new Map(), meshes = new Map(), loader = new FontLoader();
const fontUrl = (f) => '/vendor/three/fonts/' + f + '.typeface.json';

function setup() {
  if (renderer || failed) return !!renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200); camera.position.set(0, 0, 10);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    key = new THREE.DirectionalLight(0xffffff, 2.2); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5); fill.position.set(-4, -2, 5); scene.add(fill);
  } catch (e) { failed = true; renderer = null; console.error('WebGL no disponible para títulos 3D', e); }
  return !!renderer;
}
function loadFont(name) {
  if (fonts.has(name)) return Promise.resolve(fonts.get(name));
  if (!pending.has(name)) pending.set(name, new Promise((res, rej) => loader.load(fontUrl(name), (f) => { fonts.set(name, f); if (typeof Preview !== 'undefined') Preview.invalidate(); res(f); }, undefined, rej)));
  return pending.get(name);
}
function meshFor(c) {
  const t = c.t3, gk = JSON.stringify([t.text, t.font, t.depth, t.bevel]);
  let e = meshes.get(c.id);
  if (!e || e.gk !== gk) {
    if (e) { scene.remove(e.mesh); e.mesh.geometry.dispose(); }
    const geo = new TextGeometry(t.text || ' ', { font: fonts.get(t.font), size: 1, depth: Math.max(0.001, t.depth), curveSegments: 8, bevelEnabled: t.bevel > 0, bevelThickness: t.bevel, bevelSize: t.bevel * 0.8, bevelSegments: 4 });
    geo.center(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    e = { gk, mesh, width: geo.boundingBox.max.x - geo.boundingBox.min.x, height: geo.boundingBox.max.y - geo.boundingBox.min.y };
    meshes.set(c.id, e);
  }
  return e;
}
const isAnimated = (c) => c.t3.anim !== 'none';
/* Dibuja el título en el instante rel (s) y devuelve el lienzo WebGL, o null si aún carga la fuente. */
function frame(c, rel, W, H) {
  if (!setup()) return null;
  const t = c.t3;
  if (!fonts.has(t.font)) { loadFont(t.font).catch(() => {}); return null; }
  if (renderer.domElement.width !== W || renderer.domElement.height !== H) { renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); }
  const e = meshFor(c), m = e.mesh;
  for (const o of meshes.values()) o.mesh.visible = false;
  if (!m.parent) scene.add(m);
  m.visible = true;
  m.material.color.set(t.color); m.material.metalness = t.metal; m.material.roughness = t.rough;
  const viewH = 2 * Math.tan(15 * Math.PI / 180) * 10, viewW = viewH * W / H;
  const s = Math.min(t.size, (viewW * 0.86) / Math.max(0.01, e.width), (viewH * 0.8) / Math.max(0.01, e.height));
  let rx = t.rotX, ry = t.rotY, rz = t.rotZ, z = 0, p = MMX.clamp(rel / Math.max(0.01, c.dur), 0, 1);
  if (t.anim === 'spin') ry += 360 * p;
  else if (t.anim === 'swing') ry += 28 * Math.sin(rel * 1.6);
  else if (t.anim === 'tilt') { rx += 14 * (p - 0.5); ry += 36 * (p - 0.5); }
  else if (t.anim === 'flyin') { const q = 1 - Math.pow(1 - MMX.clamp(rel / 1.4, 0, 1), 3); z = -60 * (1 - q); ry += 55 * (1 - q); rx += 25 * (1 - q); }
  m.scale.setScalar(s); m.position.set(0, 0, z); m.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
  const a = t.light * Math.PI / 180; key.position.set(Math.sin(a) * 8, 5, Math.cos(a) * 8);
  renderer.render(scene, camera);
  return renderer.domElement;
}
function forget(alive) { for (const [id, e] of meshes) if (!alive.has(id)) { scene.remove(e.mesh); e.mesh.geometry.dispose(); meshes.delete(id); } }
window.Title3D = { frame, loadFont, isAnimated, forget, available: () => setup() };
