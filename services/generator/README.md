# Hero Forge — Generator service

FastAPI service that (1) compiles a brief into a fully art-directed
`GenerationPlan` with Claude, and (2) runs the asset pipeline to produce a
`ScenePackage`.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok, compiler_ready, device }` |
| `POST` | `/compile` | `{ prompt }` | `GenerationPlan` (Claude-authored) |
| `POST` | `/generate` | `GenerationPlan` | `{ job_id }` |
| `GET` | `/jobs/{id}` | — | `JobStatus` (+ `ScenePackage` when ready) |
| `GET` | `/assets/{project}/...` | — | static GLB / package files |

## Modules

| File | Responsibility |
|---|---|
| `scene_compiler.py` | Brief → `GenerationPlan` via Claude structured output. **The art-direction brain** — authors sky/lighting/camera per brief. No fixed look. |
| `schema.py` | Pydantic mirror of `@hero/scene-spec` + Structured-Outputs schema sanitizer |
| `t2i.py` | SDXL base+refiner (+ ControlNet-depth / IP-Adapter) concept images |
| `i23d.py` | TripoSR preview + InstantMesh final reconstruction |
| `terrain.py` | SDXL concept → Depth Anything → heightfield mesh |
| `bake.py` | gltfpack Draco/meshopt/KTX2 optimization |
| `pipeline.py` | orchestration + per-asset honest failure + package assembly |
| `storage.py` | package/asset writes (swap for S3/R2 + CDN in prod) |

## No-fake policy

The ML wrappers raise `ModelUnavailable` when torch/diffusers/weights/GPU are
missing. `pipeline.py` catches that per asset and records
`{"kind": "failed", "reason": ...}` — it never synthesizes geometry. The
compiler-authored sky/lighting/camera are always delivered, so the runtime
renders the designed environment regardless.

## Models & licenses

| Stage | Default | License |
|---|---|---|
| T2I | SDXL 1.0 base + refiner | CreativeML OpenRAIL++-M |
| Control | ControlNet-depth-sdxl, IP-Adapter | Apache-2.0 |
| Main 3D (preview) | TripoSR | MIT |
| Main 3D (final) | InstantMesh | Apache-2.0 |
| Depth | Depth Anything V2 | Apache-2.0 |

Every package records its provenance (models, seeds, licenses, timestamp) under
`ScenePackage.provenance`.
