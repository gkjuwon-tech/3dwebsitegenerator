import * as THREE from 'three';
import type { ScenePackage, AssetSlot } from '@hero/scene-spec';
import { Sky } from './sky.js';
import { LightRig } from './lighting.js';
import { PostPipeline } from './post.js';
import { CameraRig } from './camera-rig.js';
import { createGLTFLoader, loadGLB, type LoaderPaths } from './loaders.js';

export interface RuntimeOptions {
  loaderPaths?: LoaderPaths;
  /** device pixel ratio cap to keep fill-rate sane on retina/mobile */
  maxPixelRatio?: number;
  /** callback fired whenever an asset slot resolves or fails */
  onSlot?: (slot: 'main' | 'background', state: 'loading' | 'ready' | 'failed', detail?: string) => void;
  onReady?: () => void;
}

type SlotName = 'main' | 'background';

/**
 * The player. Renders sky + lighting + camera immediately from the package's
 * structured data, then streams in the generated GLBs as their slots resolve.
 * Nothing is faked: an unresolved slot simply leaves the stage empty.
 */
export class HeroRuntime {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);
  private clock = new THREE.Clock();

  private sky!: Sky;
  private lights!: LightRig;
  private post!: PostPipeline;
  private rig!: CameraRig;
  private loader!: ReturnType<typeof createGLTFLoader>;

  private stage = new THREE.Group();
  private models: Partial<Record<SlotName, THREE.Object3D>> = {};

  private pkg!: ScenePackage;
  private container!: HTMLElement;
  private opts: RuntimeOptions;

  private pointer = { x: 0, y: 0 };
  private scroll = 0;
  private running = false;
  private raf = 0;

  constructor(opts: RuntimeOptions = {}) {
    this.opts = opts;
    this.scene.add(this.stage);
  }

  /** Attach to a DOM element and start the render loop. */
  async mount(container: HTMLElement, pkg: ScenePackage): Promise<void> {
    this.container = container;
    this.pkg = pkg;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.opts.maxPixelRatio ?? 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

    this.loader = createGLTFLoader(this.renderer, this.opts.loaderPaths);

    this.buildScene(pkg);
    this.resize();

    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointer);
    window.addEventListener('scroll', this.onScroll, { passive: true });

    await this.resolveSlots(pkg);

    this.running = true;
    this.clock.start();
    this.loop();
    this.opts.onReady?.();
  }

  private buildScene(pkg: ScenePackage): void {
    this.sky = new Sky(pkg.sky);
    this.scene.add(this.sky.mesh);

    // prefilter the sky into an environment map so PBR meshes reflect it
    const env = this.sky.generateEnvironment(this.renderer);
    this.scene.environment = env;
    this.scene.environmentIntensity = pkg.lighting.ambient.env_intensity;

    // soft distance fog tinted to the sky's fog color
    const [fr, fg, fb] = pkg.sky.fog.color;
    this.scene.fog = new THREE.FogExp2(new THREE.Color(fr, fg, fb).getHex(), pkg.sky.fog.density * 0.02);

    this.lights = new LightRig(pkg.lighting);
    this.lights.applyRenderer(this.renderer, pkg.lighting);
    this.scene.add(this.lights.group);

    this.rig = new CameraRig(this.camera, pkg.timeline);
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, pkg.lighting, this.size());
  }

  /** Load any `glb` slots; leave `pending`/`failed` slots empty + reported. */
  private async resolveSlots(pkg: ScenePackage): Promise<void> {
    await Promise.all([
      this.resolveSlot('main', pkg.assets.main_model),
      this.resolveSlot('background', pkg.assets.background_model),
    ]);
  }

  private async resolveSlot(name: SlotName, slot: AssetSlot): Promise<void> {
    if (slot.kind !== 'glb') {
      if (slot.kind === 'failed') this.opts.onSlot?.(name, 'failed', slot.reason);
      return;
    }
    this.opts.onSlot?.(name, 'loading');
    try {
      const obj = await loadGLB(this.loader, slot.url);
      this.placeModel(name, obj);
      this.models[name] = obj;
      this.stage.add(obj);
      this.opts.onSlot?.(name, 'ready');
    } catch (err) {
      this.opts.onSlot?.(name, 'failed', err instanceof Error ? err.message : String(err));
    }
  }

  /** Center + ground a freshly loaded model. */
  private placeModel(name: SlotName, obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (name === 'main') {
      const target = this.pkg.timeline.camera_tracks[0]?.target[0] ?? [0, 0.9, 0];
      // rest the base on the ground and center horizontally over the focal point
      obj.position.x += target[0] - center.x;
      obj.position.z += target[2] - center.z;
      obj.position.y += -box.min.y;
    } else {
      // terrain: sink its top slightly below origin so the hero sits on it
      obj.position.y += -box.max.y * 0.02;
      void size;
    }
  }

  /** Replace a slot at runtime (e.g. preview GLB → final GLB). */
  async updateSlot(name: SlotName, slot: AssetSlot): Promise<void> {
    const existing = this.models[name];
    if (existing) {
      this.stage.remove(existing);
      this.disposeObject(existing);
      delete this.models[name];
    }
    this.pkg.assets[name === 'main' ? 'main_model' : 'background_model'] = slot;
    await this.resolveSlot(name, slot);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    this.sky.update(elapsed);
    this.rig.update({ scroll: this.scroll, pointer: this.pointer, elapsed }, dt);
    this.post.update(elapsed);
    this.post.render();
  };

  private size(): { width: number; height: number } {
    return { width: this.container.clientWidth || window.innerWidth, height: this.container.clientHeight || window.innerHeight };
  }

  private resize = (): void => {
    const { width, height } = this.size();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(width, height);
  };

  private onPointer = (e: PointerEvent): void => {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  };

  private onScroll = (): void => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    this.scroll = max > 0 ? THREE.MathUtils.clamp(window.scrollY / max, 0, 1) : 0;
  };

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('scroll', this.onScroll);
    Object.values(this.models).forEach((m) => m && this.disposeObject(m));
    this.sky?.dispose();
    this.lights?.dispose();
    this.post?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
