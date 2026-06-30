import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { LightingSpec } from '@hero/scene-spec';

/**
 * Final-grade pass: vignette, subtle chromatic aberration at the edges, and
 * animated film grain. These are the cheap "expensive-looking" touches that
 * separate a hobby WebGL scene from an Active-Theory-grade one.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.25 },
    uAberration: { value: 0.0015 },
    uGrain: { value: 0.04 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGrain;
    uniform vec2 uResolution;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // chromatic aberration grows toward the edges
      vec2 dir = center * uAberration * dist * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // vignette
      float vig = smoothstep(0.9, 0.2, dist * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette * 2.0);

      // animated film grain
      float g = hash(uv * uResolution + uTime * 60.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostPipeline {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    spec: LightingSpec,
    size: { width: number; height: number },
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      spec.post_fx.bloom * 4.0, // strength
      0.6, // radius
      spec.post_fx.bloom_threshold, // threshold
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader as unknown as THREE.ShaderMaterialParameters);
    this.grade.uniforms.uVignette.value = spec.post_fx.vignette;
    this.grade.uniforms.uAberration.value = spec.post_fx.chromatic_aberration;
    this.grade.uniforms.uGrain.value = spec.post_fx.grain;
    this.grade.uniforms.uResolution.value.set(size.width, size.height);
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());
    this.setSize(size.width, size.height);
  }

  update(elapsed: number): void {
    this.grade.uniforms.uTime.value = elapsed;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.grade.uniforms.uResolution.value.set(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
