/**
 * Sky-feature GLSL chunks. Each is emitted conditionally by the compiler based
 * on the SkySpec, so a `clear` sky with no aurora doesn't pay for ribbon noise.
 */

/** Base gradient + sun disc + atmospheric horizon glow. Always emitted. */
export const ATMOSPHERE_GLSL = /* glsl */ `
vec3 skyGradient(vec3 dir) {
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  // bias the gradient so most variation sits near the horizon
  float horizonBias = pow(1.0 - abs(dir.y), 4.0);
  vec3 col = mix(uHorizonColor, uZenithColor, smoothstep(0.0, 0.6, dir.y));
  col = mix(col, uGroundColor, smoothstep(0.0, -0.15, dir.y));
  // warm scattering toward the sun along the horizon
  float sunAmount = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sunAmount, 4.0) * 0.35 * uSunIntensity;
  col += uHorizonColor * horizonBias * 0.25;
  return col;
}

vec3 sunDisc(vec3 dir) {
  float d = distance(dir, normalize(uSunDir));
  float core = smoothstep(uSunSize, uSunSize * 0.4, d);
  float halo = pow(max(dot(dir, normalize(uSunDir)), 0.0), 64.0);
  return uSunColor * (core * 6.0 + halo * 0.6) * uSunIntensity;
}
`;

/** Procedural cloud band, projected onto the sky dome. */
export const CLOUDS_GLSL = /* glsl */ `
float cloudLayer(vec3 dir) {
  if (dir.y < 0.02) return 0.0;
  // project the direction onto a plane at the cloud height
  vec2 uv = dir.xz / max(dir.y, 0.08);
  uv *= 1.4;
  uv += uTime * uCloudSpeed;
  float n = fbm(uv * 1.5);
  n += 0.5 * fbm(uv * 4.0 + 9.0);
  n /= 1.5;
  float cover = 1.0 - uCloudCoverage;
  float c = smoothstep(cover, cover + 0.25, n);
  // fade clouds toward the zenith and the horizon
  c *= smoothstep(0.02, uCloudHeight, dir.y);
  c *= smoothstep(1.0, 0.4, dir.y);
  return clamp(c, 0.0, 1.0);
}
`;

/** Aurora ribbon — layered vertical noise modulated along the horizon. */
export const AURORA_GLSL = /* glsl */ `
vec3 aurora(vec3 dir) {
  if (dir.y < 0.0) return vec3(0.0);
  float band = 0.0;
  vec2 uv = vec2(atan(dir.z, dir.x) * 0.5, dir.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float speed = uTime * uAuroraSpeed * (1.0 + fi * 0.3);
    float ribbon = fbm(vec2(uv.x * 3.0 + speed, fi * 5.0));
    float h = ribbon * 0.4 + 0.35 + fi * 0.08;
    float d = abs(dir.y - h);
    band += smoothstep(0.18, 0.0, d) * (0.6 - fi * 0.15);
  }
  float curtain = fbm(vec2(uv.x * 8.0, uTime * uAuroraSpeed * 2.0));
  band *= 0.6 + 0.4 * curtain;
  return uAuroraColor * band * uAuroraIntensity;
}
`;

/** Starfield via 3D hash on the direction; fades in toward night. */
export const STARS_GLSL = /* glsl */ `
vec3 starField(vec3 dir) {
  if (dir.y < 0.0) return vec3(0.0);
  vec3 p = dir * (180.0 + uStarDensity * 220.0);
  vec3 cell = floor(p);
  float rnd = hash31(cell);
  float star = step(1.0 - uStarDensity * 0.02, rnd);
  // twinkle
  float tw = 0.6 + 0.4 * sin(uTime * 3.0 + rnd * 100.0);
  float fade = smoothstep(0.0, 0.4, dir.y);
  return vec3(star * tw * fade);
}
`;
