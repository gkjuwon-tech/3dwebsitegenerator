/**
 * @hero/shader-dsl
 *
 * Transpiles a validated {@link SkySpec} into GLSL ES 1.00 that compiles in any
 * WebGL context. The spec drives *which* code paths are emitted — a clear sky
 * never ships aurora ribbon noise — and produces a stable uniform descriptor
 * the runtime feeds straight into a THREE.ShaderMaterial.
 */
import type { SkySpec, Vec3 } from '@hero/scene-spec';
import { NOISE_GLSL } from './chunks/noise.glsl.js';
import { ATMOSPHERE_GLSL, CLOUDS_GLSL, AURORA_GLSL, STARS_GLSL } from './chunks/sky.glsl.js';

export type UniformValue = number | Vec3 | [number, number];

export interface UniformDescriptor {
  /** GLSL type, used by the runtime to build the right THREE uniform object */
  glsl: 'float' | 'vec2' | 'vec3';
  value: UniformValue;
}

export interface CompiledSky {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, UniformDescriptor>;
  /** features actually compiled in — handy for the studio UI + debugging */
  features: string[];
}

const VERTEX = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

function u(glsl: UniformDescriptor['glsl'], value: UniformValue): UniformDescriptor {
  return { glsl, value };
}

/**
 * Compile a SkySpec to a full shader program + uniform set.
 */
export function compileSky(spec: SkySpec): CompiledSky {
  const features: string[] = ['atmosphere'];
  const uniforms: Record<string, UniformDescriptor> = {
    uTime: u('float', 0),
    uSunDir: u('vec3', spec.sunDirection),
    uZenithColor: u('vec3', spec.zenithColor),
    uHorizonColor: u('vec3', spec.horizonColor),
    uGroundColor: u('vec3', spec.groundColor),
    uSunColor: u('vec3', spec.sunColor),
    uSunIntensity: u('float', spec.sunIntensity),
    uSunSize: u('float', spec.sunSize),
  };

  // ── uniform declarations (only for what we emit) ──
  const decls: string[] = [
    'uniform float uTime;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uZenithColor;',
    'uniform vec3 uHorizonColor;',
    'uniform vec3 uGroundColor;',
    'uniform vec3 uSunColor;',
    'uniform float uSunIntensity;',
    'uniform float uSunSize;',
  ];
  const helpers: string[] = [NOISE_GLSL, ATMOSPHERE_GLSL];
  const body: string[] = [
    'vec3 dir = normalize(vWorldPosition - cameraPosition);',
    'vec3 col = skyGradient(dir);',
  ];

  if (spec.clouds.enabled) {
    features.push('clouds');
    helpers.push(CLOUDS_GLSL);
    decls.push(
      'uniform float uCloudCoverage;',
      'uniform float uCloudSpeed;',
      'uniform float uCloudHeight;',
      'uniform vec3 uCloudColor;',
    );
    uniforms.uCloudCoverage = u('float', spec.clouds.coverage);
    uniforms.uCloudSpeed = u('float', spec.clouds.speed);
    uniforms.uCloudHeight = u('float', spec.clouds.height);
    uniforms.uCloudColor = u('vec3', spec.clouds.color);
    body.push(
      'float clouds = cloudLayer(dir);',
      // shade clouds by the sun so they pick up the time-of-day grade
      'float cloudShade = 0.6 + 0.4 * max(dot(dir, normalize(uSunDir)), 0.0);',
      'col = mix(col, uCloudColor * cloudShade, clouds * 0.9);',
    );
  }

  if (spec.aurora.enabled) {
    features.push('aurora');
    helpers.push(AURORA_GLSL);
    decls.push('uniform vec3 uAuroraColor;', 'uniform float uAuroraIntensity;', 'uniform float uAuroraSpeed;');
    uniforms.uAuroraColor = u('vec3', spec.aurora.color);
    uniforms.uAuroraIntensity = u('float', spec.aurora.intensity);
    uniforms.uAuroraSpeed = u('float', spec.aurora.speed);
    body.push('col += aurora(dir);');
  }

  if (spec.stars.enabled) {
    features.push('stars');
    helpers.push(STARS_GLSL);
    decls.push('uniform float uStarDensity;');
    uniforms.uStarDensity = u('float', spec.stars.density);
    // stars sit behind clouds, so add before sun disc but they self-fade by altitude
    body.push('col += starField(dir);');
  }

  // sun disc last so it reads above clouds/aurora
  body.push('col += sunDisc(dir);');
  body.push('gl_FragColor = vec4(col, 1.0);');

  const fragmentShader = [
    'precision highp float;',
    'varying vec3 vWorldPosition;',
    ...decls,
    ...helpers,
    'void main() {',
    ...body.map((l) => '  ' + l),
    '}',
  ].join('\n');

  return { vertexShader: VERTEX, fragmentShader, uniforms, features };
}

/**
 * Produce just the uniform *values* for a SkySpec, so the runtime can hot-swap
 * a sky's look without recompiling (as long as the enabled features match).
 */
export function skyUniformValues(spec: SkySpec): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {
    uSunDir: spec.sunDirection,
    uZenithColor: spec.zenithColor,
    uHorizonColor: spec.horizonColor,
    uGroundColor: spec.groundColor,
    uSunColor: spec.sunColor,
    uSunIntensity: spec.sunIntensity,
    uSunSize: spec.sunSize,
  };
  if (spec.clouds.enabled) {
    out.uCloudCoverage = spec.clouds.coverage;
    out.uCloudSpeed = spec.clouds.speed;
    out.uCloudHeight = spec.clouds.height;
    out.uCloudColor = spec.clouds.color;
  }
  if (spec.aurora.enabled) {
    out.uAuroraColor = spec.aurora.color;
    out.uAuroraIntensity = spec.aurora.intensity;
    out.uAuroraSpeed = spec.aurora.speed;
  }
  if (spec.stars.enabled) {
    out.uStarDensity = spec.stars.density;
  }
  return out;
}

export { NOISE_GLSL } from './chunks/noise.glsl.js';
