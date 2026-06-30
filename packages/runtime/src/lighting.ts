import * as THREE from 'three';
import { kelvinToRGB, type LightingSpec } from '@hero/scene-spec';

const TONE_MAP: Record<LightingSpec['post_fx']['tone_mapping'], THREE.ToneMapping> = {
  ACESFilmic: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  None: THREE.NoToneMapping,
};

/**
 * Builds a light rig from a LightingSpec and wires the renderer's tone mapping
 * + exposure. Lighting is intentionally decoupled from the sky shader: the sky
 * is what you see, this is what illuminates the meshes (plus the PMREM proxy).
 */
export class LightRig {
  readonly group = new THREE.Group();
  private ambient: THREE.AmbientLight;

  constructor(spec: LightingSpec) {
    this.group.name = 'light-rig';
    this.ambient = new THREE.AmbientLight(0xffffff, spec.ambient.intensity);
    this.group.add(this.ambient);

    for (const light of spec.lights) {
      const [r, g, b] = kelvinToRGB(light.color_kelvin);
      const color = new THREE.Color(r, g, b);
      if (light.type === 'directional') {
        const d = new THREE.DirectionalLight(color, light.intensity);
        const dir = light.direction ?? [0, -1, 0];
        // place the light opposite its direction so it points the right way
        d.position.set(-dir[0], -dir[1], -dir[2]).multiplyScalar(20);
        d.castShadow = true;
        d.shadow.mapSize.set(2048, 2048);
        d.shadow.camera.near = 0.5;
        d.shadow.camera.far = 80;
        d.shadow.bias = -0.0004;
        const c = d.shadow.camera as THREE.OrthographicCamera;
        c.left = -15; c.right = 15; c.top = 15; c.bottom = -15;
        c.updateProjectionMatrix();
        d.name = light.name;
        this.group.add(d);
        this.group.add(d.target);
      } else if (light.type === 'point') {
        const p = new THREE.PointLight(color, light.intensity, 0, 2);
        if (light.position) p.position.set(...light.position);
        p.name = light.name;
        this.group.add(p);
      } else {
        const s = new THREE.SpotLight(color, light.intensity, 0, Math.PI / 6, 0.4, 2);
        if (light.position) s.position.set(...light.position);
        s.castShadow = true;
        s.name = light.name;
        this.group.add(s);
      }
    }
  }

  /** Apply renderer-level grading from the spec. */
  applyRenderer(renderer: THREE.WebGLRenderer, spec: LightingSpec): void {
    renderer.toneMapping = TONE_MAP[spec.post_fx.tone_mapping] ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = spec.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  setEnvIntensity(scene: THREE.Scene, intensity: number): void {
    scene.environmentIntensity = intensity;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const l = o as THREE.Light & { dispose?: () => void };
      l.dispose?.();
    });
  }
}
