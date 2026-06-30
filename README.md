# Hero Forge

An **AI scene compiler** for high-end, Active-Theory / Resn-grade 3D web heroes.

You describe a site in plain language. The system does **not** stamp out a
template — it *decomposes the scene into independently-generated parts and has
the model art-direct every one of them*:

- **main model** — SDXL concept → TripoSR (preview) / InstantMesh (final) GLB
- **ground background** — SDXL terrain → Depth Anything heightfield → GLB
- **sky** — a constrained DSL the model fills in, transpiled to GLSL ES
- **lighting** — a PBR light rig (key/rim/fill, Kelvin temps, exposure, post-fx)
- **camera + interaction** — keyframed choreography with scroll/pointer/idle bindings

Sky, lighting and camera are **not** fixed scaffolding. They are first-class,
per-brief generative outputs — exactly like the models — authored as structured
JSON by the Scene Compiler and then validated. Two different briefs produce
visibly different skies, palettes, light rigs and camera moves.

> **Honesty contract:** nothing is faked to keep a demo alive. If a model stage
> can't run (no GPU/weights), that asset slot is reported `failed` with the real
> reason and the rest of the scene still ships. There is no procedural
> stand-in geometry pretending to be a generated model.

---

## Architecture

```
 prompt
   │
   ▼
 ┌──────────────────────┐   Claude (claude-opus-4-8), structured output
 │   Scene Compiler     │   → GenerationPlan { scene, image directives,
 │  services/generator  │       sky, lighting, timeline }
 └──────────┬───────────┘
            │  GenerationPlan
            ▼
 ┌──────────────────────────────────────────────┐
 │            Specialized generators             │
 │  SDXL+ControlNet+IP-Adapter  →  T2I concepts  │
 │  TripoSR / InstantMesh        →  main.glb     │
 │  SDXL + Depth Anything        →  background.glb│
 │  gltfpack (Draco/meshopt/KTX2)→  optimize     │
 └──────────┬───────────────────────────────────┘
            │  ScenePackage { assets, sky, lighting, timeline, provenance }
            ▼
 ┌──────────────────────┐   Three.js: procedural sky (+PMREM env), PBR light
 │   Runtime player     │   rig, ACES + bloom/vignette/CA/grain post, keyframe
 │  packages/runtime    │   camera with scroll-scrub + pointer parallax
 └──────────────────────┘
```

The shared contract between every stage is `@hero/scene-spec` (Zod in TS,
mirrored as Pydantic in `services/generator/app/schema.py`).

### Packages

| Package | What it is |
|---|---|
| `@hero/scene-spec` | Zod schemas + types: `SceneSpec`, `SkySpec`, `LightingSpec`, `TimelineSpec`, `GenerationPlan`, `ScenePackage` |
| `@hero/shader-dsl` | `SkySpec` → GLSL ES transpiler (conditional emission: a clear sky ships no aurora code) |
| `@hero/runtime` | Three.js player: sky dome + PMREM env, light rig, post-fx, keyframe camera rig, Draco/KTX2 loaders |
| `@hero/client` | Browser SDK for the generator service + `environmentPackage()` |
| `@hero/studio` | Vite app: prompt box → compile → live environment → models stream in |
| `services/generator` | FastAPI: `/compile` (Claude), `/generate` (asset pipeline), `/jobs/{id}` |

---

## Run it

### 1. Frontend (no GPU needed to see the runtime + studio)

```bash
npm install
npm run dev            # → http://localhost:5173
```

Without the generator service running, the studio shows an honest offline
notice — there is no baked-in scene to fall back to. Start the service to
compile real scenes.

### 2. Generator service

Core (compile only — authors the full scene incl. sky/light/camera):

```bash
cd services/generator
pip install fastapi uvicorn pydantic anthropic
export ANTHROPIC_API_KEY=sk-ant-...          # or: ant auth login
uvicorn app.main:app --reload --port 8000
```

Now a prompt in the studio compiles a full `GenerationPlan` and the runtime
renders the AI-designed **environment** immediately (sky, lighting, camera).
The model slots report `failed` until the GPU stack is installed:

Full pipeline (GPU host):

```bash
pip install -r requirements.txt
pip install git+https://github.com/VAST-AI-Research/TripoSR.git
cp .env.example .env   # set device, model repos, optional InstantMesh dir
uvicorn app.main:app --port 8000
```

### Build / typecheck

```bash
npm run build          # vite production build of the studio
npm run typecheck      # tsc across all packages
```

---

## Why this shape

The design report (`REPORT_3D`) argues that hero quality lives in the *coherence*
of camera, light rhythm, environment reflection and interaction — not in any one
mega-model. So the system keeps each of those as **editable, validated direction
data** the model authors per brief, fixes the delivery format to GLB + Draco +
KTX2, and renders in a code-first Three.js runtime. PlayCanvas is a viable
second runtime/editor target against the same `ScenePackage`.
