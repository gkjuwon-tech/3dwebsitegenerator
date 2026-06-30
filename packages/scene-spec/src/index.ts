/**
 * @hero/scene-spec
 *
 * The shared contract between every stage of the pipeline:
 *
 *   prompt ──▶ SceneSpec ──▶ GenerationPlan ──▶ ScenePackage ──▶ runtime
 *
 * Everything here is Zod-validated so the Claude-authored structured output,
 * the Python generator, and the TypeScript runtime cannot silently disagree
 * about the shape of the data. The Python side mirrors this with Pydantic
 * (services/generator/app/schema.py) — keep the two in sync.
 */
import { z } from 'zod';

/* ─────────────────────────── primitives ─────────────────────────── */

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Easing = z.enum([
  'linear',
  'easeInSine',
  'easeOutSine',
  'easeInOutSine',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInOutQuint',
  'easeOutExpo',
]);
export type Easing = z.infer<typeof Easing>;

/* ────────────────────────── 1. SceneSpec ────────────────────────── */
/**
 * Normalized scene description. This is the first artifact the compiler
 * produces from a free-text prompt — the "what should exist" before any
 * pixels or geometry are generated.
 */
export const SceneSpec = z.object({
  project_id: z.string(),
  lang: z.string().default('en-US'),
  /** short, evocative brand/style adjectives that steer T2I + grading */
  style_keywords: z.array(z.string()).default([]),

  main: z.object({
    /** what the hero object is, in plain language → drives the T2I prompt */
    subject: z.string(),
    /** material family, used by lighting + I23D post */
    material: z.enum(['glass', 'metal', 'stone', 'organic', 'ceramic', 'mixed']).default('mixed'),
    /** rough silhouette hint, helps ControlNet conditioning selection */
    silhouette: z.enum(['vertical', 'horizontal', 'compact', 'sprawling']).default('compact'),
    scale_meters: z.number().positive().default(2.0),
  }),

  background: z.object({
    /** ground-bearing background: island, tundra, dunes, grassland, … */
    ground: z.string(),
    biome: z.enum(['arctic', 'grassland', 'desert', 'volcanic', 'wetland', 'alien', 'void']).default('grassland'),
    /** how far the terrain should read to the horizon, in meters */
    extent_meters: z.number().positive().default(60),
  }),

  sky: z.object({
    description: z.string(),
    time_of_day: z.enum(['dawn', 'day', 'dusk', 'night', 'astronomical']).default('dusk'),
    weather: z.enum(['clear', 'hazy', 'overcast', 'storm']).default('clear'),
    aurora: z.boolean().default(false),
  }),

  interaction: z.object({
    mood: z.string().default('slow cinematic reveal'),
    /** which input axes drive the timeline */
    axes: z.array(z.enum(['scroll', 'pointer', 'idle', 'time'])).default(['scroll', 'pointer', 'idle']),
  }),

  camera: z.object({
    direction: z.string().default('front close-up easing into a slow orbit'),
  }),

  constraints: z.object({
    runtime: z.literal('webgl').default('webgl'),
    target_engine: z.literal('threejs').default('threejs'),
    max_initial_payload_mb: z.number().positive().default(20),
    max_main_triangles: z.number().positive().default(80_000),
    max_background_triangles: z.number().positive().default(50_000),
    target_fps_desktop: z.number().positive().default(60),
  }).default({}),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

/* ──────────────────────── 2. SkySpec (DSL) ──────────────────────── */
/**
 * The constrained sky DSL. This is NOT free GLSL — it is a small set of
 * validated knobs that @hero/shader-dsl transpiles to GLSL ES. Keeping it a
 * data structure means the sky is editable, diffable and safe to compile in
 * any browser.
 */
export const SkySpec = z.object({
  preset: z.enum(['gradient', 'atmosphere', 'nebula']).default('atmosphere'),
  /** 0..1 around the day; 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk */
  timeOfDay: z.number().min(0).max(1).default(0.78),
  sunDirection: Vec3.default([0.4, 0.18, -0.9]),
  /** linear-space sky colors, top → horizon */
  zenithColor: Vec3.default([0.04, 0.09, 0.18]),
  horizonColor: Vec3.default([0.56, 0.62, 0.82]),
  groundColor: Vec3.default([0.02, 0.03, 0.05]),
  sunColor: Vec3.default([1.0, 0.86, 0.66]),
  sunIntensity: z.number().min(0).default(1.0),
  sunSize: z.number().min(0.0001).max(0.5).default(0.015),
  /** procedural cloud layer */
  clouds: z.object({
    enabled: z.boolean().default(true),
    coverage: z.number().min(0).max(1).default(0.4),
    speed: z.number().min(0).default(0.015),
    height: z.number().min(0).max(1).default(0.55),
    color: Vec3.default([0.9, 0.93, 0.98]),
  }).default({}),
  /** aurora ribbon, only meaningful at dusk/night */
  aurora: z.object({
    enabled: z.boolean().default(false),
    intensity: z.number().min(0).default(0.6),
    color: Vec3.default([0.1, 0.85, 0.55]),
    speed: z.number().min(0).default(0.03),
  }).default({}),
  /** starfield, fades in toward night */
  stars: z.object({
    enabled: z.boolean().default(true),
    density: z.number().min(0).max(1).default(0.5),
  }).default({}),
  fog: z.object({
    density: z.number().min(0).default(0.015),
    color: Vec3.default([0.5, 0.55, 0.62]),
  }).default({}),
});
export type SkySpec = z.infer<typeof SkySpec>;

/* ─────────────────────── 3. LightingSpec ────────────────────────── */
export const LightSpec = z.object({
  type: z.enum(['directional', 'point', 'spot']),
  name: z.string(),
  direction: Vec3.optional(),
  position: Vec3.optional(),
  intensity: z.number().min(0),
  /** color expressed as temperature so it stays physically coherent */
  color_kelvin: z.number().min(1000).max(20000).default(6500),
});
export type LightSpec = z.infer<typeof LightSpec>;

export const LightingSpec = z.object({
  mode: z.literal('pbr').default('pbr'),
  exposure: z.number().min(0).default(1.0),
  ambient: z.object({
    intensity: z.number().min(0).default(0.3),
    /** the environment is prefiltered from the sky shader at runtime */
    env_proxy: z.literal('procedural_pmrem').default('procedural_pmrem'),
    env_intensity: z.number().min(0).default(1.0),
  }).default({}),
  lights: z.array(LightSpec).default([]),
  post_fx: z.object({
    tone_mapping: z.enum(['ACESFilmic', 'AgX', 'Reinhard', 'None']).default('ACESFilmic'),
    bloom: z.number().min(0).default(0.08),
    bloom_threshold: z.number().min(0).default(0.85),
    vignette: z.number().min(0).default(0.25),
    chromatic_aberration: z.number().min(0).default(0.0015),
    grain: z.number().min(0).default(0.04),
  }).default({}),
});
export type LightingSpec = z.infer<typeof LightingSpec>;

/* ──────────────────────── 4. TimelineSpec ───────────────────────── */
export const CameraTrack = z.object({
  id: z.string(),
  fov: z.number().min(1).max(120).default(38),
  times: z.array(z.number().min(0)),
  position: z.array(Vec3),
  target: z.array(Vec3),
  easing: z.array(Easing).default([]),
});
export type CameraTrack = z.infer<typeof CameraTrack>;

export const InteractionBinding = z.object({
  event: z.enum(['scroll', 'pointer', 'idle', 'time']),
  /** for scroll: normalized [0..1] page range mapped onto the track */
  range: z.tuple([z.number(), z.number()]).optional(),
  track_id: z.string().optional(),
  mode: z.enum(['scrub', 'play', 'micro_parallax', 'auto_orbit']).default('scrub'),
  target: z.enum(['camera', 'main_model', 'background_model']).default('camera'),
  strength: z.number().default(1),
});
export type InteractionBinding = z.infer<typeof InteractionBinding>;

export const TimelineSpec = z.object({
  duration_sec: z.number().positive().default(12),
  camera_tracks: z.array(CameraTrack),
  interaction_bindings: z.array(InteractionBinding).default([]),
});
export type TimelineSpec = z.infer<typeof TimelineSpec>;

/* ───────────────────── 5. GenerationPlan ────────────────────────── */
/**
 * The compiler's full output: SceneSpec + every downstream connoiseur spec +
 * the concrete prompts/conditioning the generator service needs. This is the
 * structured object Claude returns from /compile.
 */
export const ImageDirective = z.object({
  /** positive T2I prompt */
  prompt: z.string(),
  negative_prompt: z.string().default('blurry, low quality, watermark, text, extra limbs'),
  /** ControlNet conditioning to request, in priority order */
  control: z.array(z.enum(['depth', 'canny', 'normal', 'none'])).default(['depth']),
  /** seed for reproducibility; null = random */
  seed: z.number().int().nullable().default(null),
  guidance_scale: z.number().min(0).default(6.5),
});
export type ImageDirective = z.infer<typeof ImageDirective>;

export const GenerationPlan = z.object({
  scene: SceneSpec,
  main_image: ImageDirective,
  background_image: ImageDirective,
  sky: SkySpec,
  lighting: LightingSpec,
  timeline: TimelineSpec,
  /** free-text rationale from the compiler — surfaced in the studio UI */
  notes: z.string().default(''),
});
export type GenerationPlan = z.infer<typeof GenerationPlan>;

/* ───────────────────── 6. ScenePackage ──────────────────────────── */
/**
 * The runtime's input. Asset slots are tagged unions: a slot is either a real
 * generated GLB (`glb` + url) or `pending` while the generator works. The
 * runtime renders sky/lighting/camera immediately and drops models in as their
 * slots resolve — no placeholder geometry is ever invented.
 */
export const AssetSlot = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('glb'), url: z.string(), triangles: z.number().optional() }),
  z.object({ kind: z.literal('pending') }),
  z.object({ kind: z.literal('failed'), reason: z.string() }),
]);
export type AssetSlot = z.infer<typeof AssetSlot>;

export const GenerationProvenance = z.object({
  t2i_model: z.string().optional(),
  image_control: z.array(z.string()).default([]),
  main_i23d: z.string().optional(),
  background_pipeline: z.string().optional(),
  compiler_model: z.string().optional(),
  licenses: z.array(z.string()).default([]),
  seeds: z.record(z.number()).default({}),
  created_at: z.string().optional(),
});
export type GenerationProvenance = z.infer<typeof GenerationProvenance>;

export const ScenePackage = z.object({
  version: z.literal('0.1').default('0.1'),
  project_id: z.string(),
  assets: z.object({
    main_model: AssetSlot,
    background_model: AssetSlot,
  }),
  sky: SkySpec,
  lighting: LightingSpec,
  timeline: TimelineSpec,
  provenance: GenerationProvenance.default({}),
});
export type ScenePackage = z.infer<typeof ScenePackage>;

/* ───────────────────────── helpers ──────────────────────────────── */

/** Parse + fill defaults for a package coming off the wire. */
export function parseScenePackage(raw: unknown): ScenePackage {
  return ScenePackage.parse(raw);
}

/** Parse a compiler plan. */
export function parseGenerationPlan(raw: unknown): GenerationPlan {
  return GenerationPlan.parse(raw);
}

/** Kelvin → linear RGB approximation (Tanner Helland fit, normalized). */
export function kelvinToRGB(kelvin: number): Vec3 {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  // sRGB → linear
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(clamp(r)), lin(clamp(g)), lin(clamp(b))];
}
