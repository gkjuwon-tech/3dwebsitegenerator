import { HeroClient, environmentPackage } from '@hero/client';
import { HeroRuntime } from '@hero/runtime';
import type { GenerationPlan, ScenePackage, AssetSlot } from '@hero/scene-spec';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const form = $('composer') as HTMLFormElement;
const promptEl = $('prompt') as HTMLTextAreaElement;
const goBtn = $('go') as HTMLButtonElement;
const statusEl = $('status');
const readout = $('readout');
const notesEl = $('notes');
const provEl = $('provenance');
const slotsEl = $('slots');

const client = new HeroClient('/api');
let runtime: HeroRuntime | null = null;

type SlotState = 'pending' | 'loading' | 'ready' | 'failed';
const slotUI: Record<'main' | 'background', { state: SlotState; reason?: string }> = {
  main: { state: 'pending' },
  background: { state: 'pending' },
};

function setStatus(msg: string, kind: '' | 'ok' | 'error' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function renderSlots(): void {
  const label: Record<'main' | 'background', string> = { main: 'Main model', background: 'Ground' };
  slotsEl.innerHTML = '';
  (['main', 'background'] as const).forEach((name) => {
    const { state, reason } = slotUI[name];
    const row = document.createElement('div');
    row.className = 'slot';
    const dot = state === 'pending' ? '' : state;
    row.innerHTML =
      `<span class="dot ${dot}"></span><strong>${label[name]}</strong>` +
      `<span class="reason">${reason ?? state}</span>`;
    slotsEl.appendChild(row);
  });
}

function renderReadout(plan: GenerationPlan): void {
  readout.hidden = false;
  notesEl.textContent = plan.notes || '';
  const sky = plan.sky;
  const rows: [string, string][] = [
    ['Hero', `${plan.scene.main.subject.slice(0, 40)} (${plan.scene.main.material})`],
    ['Ground', `${plan.scene.background.ground.slice(0, 36)}`],
    ['Time of day', `${sky.timeOfDay.toFixed(2)} · ${plan.scene.sky.weather}`],
    ['Sky features', [sky.clouds.enabled && 'clouds', sky.aurora.enabled && 'aurora', sky.stars.enabled && 'stars'].filter(Boolean).join(', ') || 'clear'],
    ['Lights', plan.lighting.lights.map((l) => l.name).join(', ')],
    ['Tone map', plan.lighting.post_fx.tone_mapping],
    ['Camera keys', String(plan.timeline.camera_tracks[0]?.times.length ?? 0)],
  ];
  provEl.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  renderSlots();
}

async function mountEnvironment(pkg: ScenePackage): Promise<void> {
  runtime?.dispose();
  slotUI.main = { state: pkg.assets.main_model.kind === 'glb' ? 'ready' : 'pending' };
  slotUI.background = { state: pkg.assets.background_model.kind === 'glb' ? 'ready' : 'pending' };
  runtime = new HeroRuntime({
    onSlot: (slot, state, detail) => {
      slotUI[slot] = { state, reason: detail };
      renderSlots();
    },
  });
  await runtime.mount(stage, pkg);
  renderSlots();
}

function applyResolvedSlots(pkg: ScenePackage): void {
  if (!runtime) return;
  const map: [keyof ScenePackage['assets'], 'main' | 'background'][] = [
    ['main_model', 'main'],
    ['background_model', 'background'],
  ];
  for (const [key, name] of map) {
    const slot = pkg.assets[key] as AssetSlot;
    if (slot.kind === 'glb') {
      void runtime.updateSlot(name, slot);
    } else if (slot.kind === 'failed') {
      slotUI[name] = { state: 'failed', reason: slot.reason };
      renderSlots();
    }
  }
}

async function run(prompt: string): Promise<void> {
  goBtn.disabled = true;
  try {
    setStatus('Compiling scene with the art-director model…');
    const plan = await client.compile(prompt);
    renderReadout(plan);

    // render the AI-designed environment immediately; models stream in after
    setStatus('Environment ready. Generating models…', 'ok');
    await mountEnvironment(environmentPackage(plan));

    const jobId = await client.generate(plan);
    const final = await client.pollJob(jobId, (s) => {
      setStatus(`Generating · ${s.stage} · ${(s.progress * 100) | 0}%`);
      if (s.package) applyResolvedSlots(s.package);
    });

    if (final.status === 'failed') {
      setStatus(`Generation failed: ${final.error ?? 'unknown error'}`, 'error');
    } else if (final.package) {
      applyResolvedSlots(final.package);
      const anyModel =
        final.package.assets.main_model.kind === 'glb' ||
        final.package.assets.background_model.kind === 'glb';
      setStatus(anyModel ? 'Scene complete.' : 'Environment complete (models unavailable — see slots).', anyModel ? 'ok' : '');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, 'error');
  } finally {
    goBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (prompt) void run(prompt);
});

// honest offline state — no fabricated scene is shown
client.health().then((ok) => {
  if (!ok) {
    setStatus(
      'Generator service offline. Start services/generator (uvicorn app.main:app) ' +
        'and set ANTHROPIC_API_KEY to compile a scene.',
      'error',
    );
  } else {
    setStatus('Generator online. Describe a scene to compile.', 'ok');
  }
});
