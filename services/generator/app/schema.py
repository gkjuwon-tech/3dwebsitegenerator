"""Pydantic mirror of @hero/scene-spec, plus helpers to emit a Structured-
Outputs-compatible JSON schema for the Claude compiler.

The TypeScript Zod schema (packages/scene-spec) is the source of truth for the
*runtime*; this is the source of truth for the *compiler*. Keep them in lockstep.
The compiler is what gives sky/lighting/camera their per-site values — there are
no defaults baked in here beyond what makes a field optional.
"""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field

Vec3 = List[float]  # length-3 enforced post-hoc (structured outputs can't do prefixItems)

Easing = Literal[
    "linear", "easeInSine", "easeOutSine", "easeInOutSine",
    "easeInCubic", "easeOutCubic", "easeInOutCubic", "easeInOutQuint", "easeOutExpo",
]


# ── SceneSpec ──
class MainSpec(BaseModel):
    subject: str
    material: Literal["glass", "metal", "stone", "organic", "ceramic", "mixed"]
    silhouette: Literal["vertical", "horizontal", "compact", "sprawling"]
    scale_meters: float


class BackgroundSpec(BaseModel):
    ground: str
    biome: Literal["arctic", "grassland", "desert", "volcanic", "wetland", "alien", "void"]
    extent_meters: float


class SkyBriefSpec(BaseModel):
    description: str
    time_of_day: Literal["dawn", "day", "dusk", "night", "astronomical"]
    weather: Literal["clear", "hazy", "overcast", "storm"]
    aurora: bool


class InteractionSpec(BaseModel):
    mood: str
    axes: List[Literal["scroll", "pointer", "idle", "time"]]


class CameraBriefSpec(BaseModel):
    direction: str


class ConstraintsSpec(BaseModel):
    runtime: Literal["webgl"]
    target_engine: Literal["threejs"]
    max_initial_payload_mb: float
    max_main_triangles: float
    max_background_triangles: float
    target_fps_desktop: float


class SceneSpec(BaseModel):
    project_id: str
    lang: str
    style_keywords: List[str]
    main: MainSpec
    background: BackgroundSpec
    sky: SkyBriefSpec
    interaction: InteractionSpec
    camera: CameraBriefSpec
    constraints: ConstraintsSpec


# ── SkySpec (DSL) ──
class CloudsSpec(BaseModel):
    enabled: bool
    coverage: float
    speed: float
    height: float
    color: Vec3


class AuroraSpec(BaseModel):
    enabled: bool
    intensity: float
    color: Vec3
    speed: float


class StarsSpec(BaseModel):
    enabled: bool
    density: float


class FogSpec(BaseModel):
    density: float
    color: Vec3


class SkySpec(BaseModel):
    preset: Literal["gradient", "atmosphere", "nebula"]
    timeOfDay: float
    sunDirection: Vec3
    zenithColor: Vec3
    horizonColor: Vec3
    groundColor: Vec3
    sunColor: Vec3
    sunIntensity: float
    sunSize: float
    clouds: CloudsSpec
    aurora: AuroraSpec
    stars: StarsSpec
    fog: FogSpec


# ── LightingSpec ──
class LightSpec(BaseModel):
    type: Literal["directional", "point", "spot"]
    name: str
    direction: Optional[Vec3] = None
    position: Optional[Vec3] = None
    intensity: float
    color_kelvin: float


class AmbientSpec(BaseModel):
    intensity: float
    env_proxy: Literal["procedural_pmrem"]
    env_intensity: float


class PostFxSpec(BaseModel):
    tone_mapping: Literal["ACESFilmic", "AgX", "Reinhard", "None"]
    bloom: float
    bloom_threshold: float
    vignette: float
    chromatic_aberration: float
    grain: float


class LightingSpec(BaseModel):
    mode: Literal["pbr"]
    exposure: float
    ambient: AmbientSpec
    lights: List[LightSpec]
    post_fx: PostFxSpec


# ── TimelineSpec ──
class CameraTrack(BaseModel):
    id: str
    fov: float
    times: List[float]
    position: List[Vec3]
    target: List[Vec3]
    easing: List[Easing]


class InteractionBinding(BaseModel):
    event: Literal["scroll", "pointer", "idle", "time"]
    range: Optional[List[float]] = None
    track_id: Optional[str] = None
    mode: Literal["scrub", "play", "micro_parallax", "auto_orbit"]
    target: Literal["camera", "main_model", "background_model"]
    strength: float


class TimelineSpec(BaseModel):
    duration_sec: float
    camera_tracks: List[CameraTrack]
    interaction_bindings: List[InteractionBinding]


# ── ImageDirective + GenerationPlan ──
class ImageDirective(BaseModel):
    prompt: str
    negative_prompt: str
    control: List[Literal["depth", "canny", "normal", "none"]]
    seed: Optional[int] = None
    guidance_scale: float


class GenerationPlan(BaseModel):
    scene: SceneSpec
    main_image: ImageDirective
    background_image: ImageDirective
    sky: SkySpec
    lighting: LightingSpec
    timeline: TimelineSpec
    notes: str


# ── Structured-output schema sanitizer ──
_UNSUPPORTED_KEYS = {
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minItems", "maxItems", "minLength", "maxLength", "default", "title", "format",
}


def _sanitize(node: Any) -> Any:
    """Recursively coerce a pydantic JSON schema into the subset Structured
    Outputs accepts: every object gets additionalProperties:false and all of its
    properties marked required; numeric/length constraints are dropped."""
    if isinstance(node, dict):
        node = {k: _sanitize(v) for k, v in node.items() if k not in _UNSUPPORTED_KEYS}
        if node.get("type") == "object" and "properties" in node:
            node["additionalProperties"] = False
            node["required"] = list(node["properties"].keys())
        return node
    if isinstance(node, list):
        return [_sanitize(v) for v in node]
    return node


def plan_json_schema() -> dict:
    """The JSON schema handed to client.messages with output_config.format."""
    return _sanitize(GenerationPlan.model_json_schema())
