/**
 * @hero/client
 *
 * Browser SDK for the generator service. The service exposes:
 *   POST /compile     { prompt }                 → GenerationPlan
 *   POST /generate    GenerationPlan             → { job_id }
 *   GET  /jobs/{id}                              → JobStatus (+ ScenePackage)
 *
 * It also provides `environmentPackage()` — a real sky/lighting/camera package
 * with *pending* model slots — so the runtime can render the environment the
 * instant a plan exists, before any GPU work finishes. No placeholder geometry
 * is ever fabricated; the model slots stay empty until the service fills them.
 */
import {
  GenerationPlan,
  ScenePackage,
  parseGenerationPlan,
  parseScenePackage,
} from '@hero/scene-spec';

export interface JobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string;
  progress: number;
  package?: ScenePackage;
  error?: string;
}

export class HeroClient {
  constructor(private baseUrl = '/api') {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  /** prompt → structured GenerationPlan (Claude-authored, server-side). */
  async compile(prompt: string): Promise<GenerationPlan> {
    const raw = await this.post<unknown>('/compile', { prompt });
    return parseGenerationPlan(raw);
  }

  /** kick off asset generation for a plan. */
  async generate(plan: GenerationPlan): Promise<string> {
    const { job_id } = await this.post<{ job_id: string }>('/generate', plan);
    return job_id;
  }

  async getJob(jobId: string): Promise<JobStatus> {
    const res = await fetch(`${this.baseUrl}/jobs/${jobId}`);
    if (!res.ok) throw new Error(`/jobs/${jobId} → ${res.status}`);
    const status = (await res.json()) as JobStatus;
    if (status.package) status.package = parseScenePackage(status.package);
    return status;
  }

  /** Poll a job to completion, surfacing each intermediate package. */
  async pollJob(jobId: string, onUpdate: (s: JobStatus) => void, intervalMs = 1500): Promise<JobStatus> {
    for (;;) {
      const s = await this.getJob(jobId);
      onUpdate(s);
      if (s.status === 'done' || s.status === 'failed') return s;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** Is the generator service reachable? */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Build a ScenePackage that renders the *environment* of a plan (sky, lighting,
 * camera) with both model slots marked pending. This is what the runtime mounts
 * immediately after /compile while /generate runs.
 */
export function environmentPackage(plan: GenerationPlan): ScenePackage {
  return parseScenePackage({
    version: '0.1',
    project_id: plan.scene.project_id,
    assets: {
      main_model: { kind: 'pending' },
      background_model: { kind: 'pending' },
    },
    sky: plan.sky,
    lighting: plan.lighting,
    timeline: plan.timeline,
  });
}

export { SceneSpec } from '@hero/scene-spec';
