/**
 * Standalone Three.js hero player (Claude layer).
 *
 * A no-build port of @hero/runtime. It consumes a ScenePackage written by the
 * Colab assembler: package.json + sky.frag/sky.vert + GLB assets. It renders the
 * AI-designed sky/lighting/camera immediately and drops in generated GLBs as the
 * slots resolve. Nothing is faked — an empty/failed slot just leaves the stage
 * empty. three.js is loaded from a CDN via the import map in index.html.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ── easing ── */
const EASINGS = {
  linear: (t) => t,
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};
const ease = (name, t) => (EASINGS[name] ?? EASINGS.linear)(t);

/* ── kelvin → linear rgb ── */
function kelvinToRGB(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x) => Math.min(255, Math.max(0, x)) / 255;
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return [lin(c(r)), lin(c(g)), lin(c(b))];
}

const TONE = {
  ACESFilmic: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping,
  Reinhard: THREE.ReinhardToneMapping, None: THREE.NoToneMapping,
};

/* ── sky ── */
function buildSky(renderer, scene, sky, fragText, vertText) {
  const uniforms = {};
  for (const [name, val] of Object.entries(sky.uniforms)) {
    uniforms[name] = { value: Array.isArray(val) ? new THREE.Vector3(...val) : val };
  }
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: vertText, fragmentShader: fragText,
    side: THREE.BackSide, depthWrite: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // PMREM environment so PBR meshes reflect the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
  dome.frustumCulled = false; envScene.add(dome);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
  dome.geometry.dispose(); pmrem.dispose();
  return { material, env: rt.texture };
}

/* ── lighting ── */
function buildLights(scene, renderer, lighting) {
  const group = new THREE.Group();
  group.add(new THREE.AmbientLight(0xffffff, lighting.ambient.intensity));
  for (const l of lighting.lights) {
    const [r, g, b] = kelvinToRGB(l.color_kelvin);
    const color = new THREE.Color(r, g, b);
    if (l.type === 'directional') {
      const d = new THREE.DirectionalLight(color, l.intensity);
      const dir = l.direction ?? [0, -1, 0];
      d.position.set(-dir[0], -dir[1], -dir[2]).multiplyScalar(20);
      d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
      d.shadow.camera.near = 0.5; d.shadow.camera.far = 80; d.shadow.bias = -0.0004;
      Object.assign(d.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
      d.shadow.camera.updateProjectionMatrix();
      group.add(d, d.target);
    } else if (l.type === 'point') {
      const p = new THREE.PointLight(color, l.intensity, 0, 2);
      if (l.position) p.position.set(...l.position);
      group.add(p);
    } else {
      const s = new THREE.SpotLight(color, l.intensity, 0, Math.PI / 6, 0.4, 2);
      if (l.position) s.position.set(...l.position);
      s.castShadow = true; group.add(s);
    }
  }
  scene.add(group);
  renderer.toneMapping = TONE[lighting.post_fx.tone_mapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lighting.exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/* ── post ── */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.25 },
    uAberration: { value: 0.0015 }, uGrain: { value: 0.04 }, uResolution: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float; varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform float uTime,uVignette,uAberration,uGrain; uniform vec2 uResolution;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv=vUv; vec2 c=uv-0.5; float dist=length(c);
      vec2 d=c*uAberration*dist*2.0;
      vec3 col; col.r=texture2D(tDiffuse,uv+d).r; col.g=texture2D(tDiffuse,uv).g; col.b=texture2D(tDiffuse,uv-d).b;
      float vig=smoothstep(0.9,0.2,dist*(1.0+uVignette)); col*=mix(1.0,vig,uVignette*2.0);
      col+=(hash(uv*uResolution+uTime*60.0)-0.5)*uGrain;
      gl_FragColor=vec4(col,1.0);
    }`,
};

function buildPost(renderer, scene, camera, lighting, w, h) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), lighting.post_fx.bloom * 4.0, 0.6, lighting.post_fx.bloom_threshold);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uVignette.value = lighting.post_fx.vignette;
  grade.uniforms.uAberration.value = lighting.post_fx.chromatic_aberration;
  grade.uniforms.uGrain.value = lighting.post_fx.grain;
  grade.uniforms.uResolution.value.set(w, h);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, bloom, grade };
}

/* ── camera rig ── */
class CameraRig {
  constructor(camera, timeline) {
    this.camera = camera;
    this.track = timeline.camera_tracks[0] ?? null;
    this.bindings = timeline.interaction_bindings ?? [];
    this.duration = timeline.duration_sec;
    this.p = new THREE.Vector3(); this.t = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.right = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.fwd = new THREE.Vector3();
    this.pe = { x: 0, y: 0 };
    this.focus = null; this._camDir = new THREE.Vector3();
  }
  setFocus(center, radius) { this.focus = { center: center.clone(), radius }; }
  evaluate(u) {
    const tr = this.track, n = tr.times.length;
    if (n === 1) { this.p.fromArray(tr.position[0]); this.t.fromArray(tr.target[0]); return; }
    const total = tr.times[n - 1] || 1, tt = THREE.MathUtils.clamp(u, 0, 1) * total;
    let i = 0; while (i < n - 2 && tr.times[i + 1] < tt) i++;
    const t0 = tr.times[i], t1 = tr.times[i + 1], seg = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
    const e = ease(tr.easing[i], seg);
    this.p.fromArray(tr.position[i]).lerp(this.tmp.fromArray(tr.position[i + 1]), e);
    this.t.fromArray(tr.target[i]).lerp(this.tmp.fromArray(tr.target[i + 1]), e);
  }
  update(scroll, pointer, elapsed, dt) {
    if (!this.track) return;
    const sb = this.bindings.find((b) => b.event === 'scroll' && b.mode === 'scrub' && b.target === 'camera');
    let u;
    if (sb) { const [a, b] = sb.range ?? [0, 1]; u = b > a ? THREE.MathUtils.clamp((scroll - a) / (b - a), 0, 1) : 0; }
    else u = (elapsed / this.duration) % 1;
    this.evaluate(u);

    const ib = this.bindings.find((b) => b.event === 'idle' && b.mode === 'auto_orbit');
    if (ib) {
      const ang = elapsed * 0.06 * ib.strength; this.p.sub(this.t);
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const x = this.p.x * cs - this.p.z * sn, z = this.p.x * sn + this.p.z * cs;
      this.p.x = x; this.p.z = z; this.p.add(this.t);
    }
    const pb = this.bindings.find((b) => b.event === 'pointer' && b.mode === 'micro_parallax');
    if (pb) {
      const k = 1 - Math.pow(0.0001, dt);
      this.pe.x += (pointer.x - this.pe.x) * k; this.pe.y += (pointer.y - this.pe.y) * k;
      this.fwd.copy(this.t).sub(this.p).normalize();
      this.right.crossVectors(this.fwd, this.up).normalize();
      this.p.addScaledVector(this.right, this.pe.x * pb.strength);
      this.p.addScaledVector(this.up, this.pe.y * pb.strength);
    }
    // Frame the hero so it ALWAYS fits, on any aspect: look at its bounding
    // sphere and, if the authored camera is too close for this viewport, dolly
    // back until the sphere fits the tighter of the vertical/horizontal FOV.
    // This is what keeps mobile portrait from cropping — no magic constants.
    let lookAt = this.t;
    if (this.track.fov && Math.abs(this.camera.fov - this.track.fov) > 0.01) {
      this.camera.fov = this.track.fov; this.camera.updateProjectionMatrix();
    }
    if (this.focus) {
      lookAt = this.focus.center;
      const vFov = THREE.MathUtils.degToRad(this.camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
      const need = (this.focus.radius * 1.3) / Math.sin(Math.min(vFov, hFov) / 2);
      const dir = this._camDir.copy(this.p).sub(lookAt);
      const dist = dir.length() || 1;
      if (dist < need) this.p.copy(lookAt).add(dir.multiplyScalar(need / dist));
    }
    this.camera.position.copy(this.p);
    this.camera.lookAt(lookAt);
  }
}

/* ── GLB loading + placement ── */
function makeLoader() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://unpkg.com/three@0.169.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  return loader;
}
function placeModel(name, obj, timeline, opts = {}) {
  const box = new THREE.Box3().setFromObject(obj);
  if (name === 'main') {
    // TripoSR meshes are unit-normalized → scale to the intended real height
    const size = box.getSize(new THREE.Vector3());
    obj.scale.setScalar((opts.scaleMeters ?? 3.5) / Math.max(size.y, 1e-3));
    let b2 = new THREE.Box3().setFromObject(obj);
    const c2 = b2.getCenter(new THREE.Vector3());
    const target = timeline.camera_tracks[0]?.target[0] ?? [0, 0.9, 0];
    obj.position.x += target[0] - c2.x;
    obj.position.z += target[2] - c2.z;
    // seat the base on the ACTUAL terrain surface (raycast down) + embed, so the
    // hero reads as part of the ground instead of resting on the y=0 plane
    let surfaceY = 0;
    if (opts.ground) {
      const ray = new THREE.Raycaster(new THREE.Vector3(target[0], 200, target[2]), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(opts.ground, true)[0];
      if (hit) surfaceY = hit.point.y;
    }
    b2 = new THREE.Box3().setFromObject(obj);
    obj.position.y += surfaceY - b2.min.y - 0.3;
  } else {
    obj.position.y += -box.max.y * 0.02;
  }
}

/* ── boot ── */
async function main() {
  let pkg;
  try { pkg = await (await fetch('./package.json')).json(); }
  catch { return showError('Could not load package.json next to this page.'); }

  const [fragText, vertText] = await Promise.all([
    fetch('./' + pkg.sky.frag).then((r) => r.text()),
    fetch('./' + pkg.sky.vert).then((r) => r.text()),
  ]);

  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);

  const sky = buildSky(renderer, scene, pkg.sky, fragText, vertText);
  scene.environment = sky.env;
  scene.environmentIntensity = pkg.lighting.ambient.env_intensity ?? 1;
  const fog = pkg.sky.fog ?? { color: [0.4, 0.42, 0.55], density: 0.012 };
  scene.fog = new THREE.FogExp2(new THREE.Color(...fog.color).getHex(), fog.density * 0.02);

  buildLights(scene, renderer, pkg.lighting);
  const rig = new CameraRig(camera, pkg.timeline);

  const size = () => ({ w: innerWidth, h: innerHeight });
  let { w, h } = size();
  const post = buildPost(renderer, scene, camera, pkg.lighting, w, h);

  const resize = () => {
    ({ w, h } = size());
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    post.composer.setSize(w, h); post.bloom.setSize(w, h);
    post.grade.uniforms.uResolution.value.set(w, h);
  };
  addEventListener('resize', resize); resize();

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / innerHeight) * 2 - 1);
  });
  let scroll = 0;
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scroll = max > 0 ? THREE.MathUtils.clamp(scrollY / max, 0, 1) : 0;
  }, { passive: true });

  // load generated GLBs (honest: skip pending/failed)
  const loader = makeLoader();
  // terrain first so the hero can be seated onto its actual surface
  const slots = [['background_model', 'background'], ['main_model', 'main']];
  const scaleMeters = pkg.scene?.main_scale_meters ?? 3.5;
  let ground = null;
  for (const [key, name] of slots) {
    const slot = pkg.assets[key];
    if (slot?.kind !== 'glb') continue;
    try {
      const gltf = await loader.loadAsync('./' + slot.url);
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      placeModel(name, gltf.scene, pkg.timeline, { ground, scaleMeters });
      if (name === 'background') ground = gltf.scene;
      else if (name === 'main') {
        const sph = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());
        rig.setFocus(sph.center, sph.radius);
      }
      scene.add(gltf.scene);
    } catch (e) { console.warn(`slot ${name} failed:`, e); }
  }

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), elapsed = clock.elapsedTime;
    sky.material.uniforms.uTime.value = elapsed;
    rig.update(scroll, pointer, elapsed, dt);
    post.grade.uniforms.uTime.value = elapsed;
    post.composer.render();
  })();
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'err'; el.textContent = msg;
  document.body.appendChild(el);
}

main().catch((e) => showError(String(e)));
