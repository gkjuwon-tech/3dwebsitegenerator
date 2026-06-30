import * as THREE from 'three';
import type { SkySpec } from '@hero/scene-spec';
import { compileSky, skyUniformValues, type CompiledSky, type UniformValue } from '@hero/shader-dsl';

function toUniform(value: UniformValue): THREE.IUniform {
  if (typeof value === 'number') return { value };
  if (value.length === 2) return { value: new THREE.Vector2(value[0], value[1]) };
  return { value: new THREE.Vector3(value[0], value[1], value[2]) };
}

function assignUniform(uni: THREE.IUniform, value: UniformValue): void {
  if (typeof value === 'number') {
    uni.value = value;
  } else if (value.length === 2) {
    (uni.value as THREE.Vector2).set(value[0], value[1]);
  } else {
    (uni.value as THREE.Vector3).set(value[0], value[1], value[2]);
  }
}

/**
 * Procedural sky dome. Owns the ShaderMaterial compiled from the SkySpec and
 * can prefilter itself into an environment map (PMREM) so PBR meshes reflect
 * the same sky they sit under — the "mesh floating apart from the sky" fix
 * called out in the design report.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private compiled: CompiledSky;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(spec: SkySpec, radius = 4000) {
    this.compiled = compileSky(spec);
    const uniforms: Record<string, THREE.IUniform> = {};
    for (const [name, desc] of Object.entries(this.compiled.uniforms)) {
      uniforms[name] = toUniform(desc.value);
    }
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: this.compiled.vertexShader,
      fragmentShader: this.compiled.fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: true,
    });
    const geo = new THREE.SphereGeometry(radius, 64, 32);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
  }

  get features(): string[] {
    return this.compiled.features;
  }

  /** Advance procedural animation. */
  update(elapsed: number): void {
    this.material.uniforms.uTime.value = elapsed;
  }

  /** Hot-swap colors/params for the same feature set (no recompile). */
  applySpec(spec: SkySpec): void {
    const values = skyUniformValues(spec);
    for (const [name, value] of Object.entries(values)) {
      const uni = this.material.uniforms[name];
      if (uni) assignUniform(uni, value);
    }
  }

  /**
   * Prefilter the sky into an irradiance/specular environment map.
   * Returns the env texture to assign to Scene.environment.
   */
  generateEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    // a temporary dome sized for the cube camera; reuse the same material
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), this.material);
    dome.frustumCulled = false;
    envScene.add(dome);
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
    dome.geometry.dispose();
    pmrem.dispose();
    return this.envRT.texture;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.envRT?.dispose();
  }
}
