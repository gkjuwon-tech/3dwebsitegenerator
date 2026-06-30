import * as THREE from 'three';
import type { CameraTrack, TimelineSpec, InteractionBinding } from '@hero/scene-spec';
import { applyEasing } from './easing.js';

interface RigInput {
  /** normalized scroll progress over the page, 0..1 */
  scroll: number;
  /** normalized pointer position, each axis -1..1 */
  pointer: { x: number; y: number };
  /** seconds since start */
  elapsed: number;
}

/**
 * Plays a keyframed camera track and folds in the timeline's interaction
 * bindings: scroll scrubs the playhead, pointer drives micro-parallax, idle
 * adds a slow auto-orbit. All structured data — no hand-authored camera code.
 */
export class CameraRig {
  private track: CameraTrack | null;
  private bindings: InteractionBinding[];
  private duration: number;

  private _pos = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _tmp = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);
  private _fwd = new THREE.Vector3();
  private _pointerEased = { x: 0, y: 0 };

  constructor(private camera: THREE.PerspectiveCamera, timeline: TimelineSpec) {
    this.track = timeline.camera_tracks[0] ?? null;
    this.bindings = timeline.interaction_bindings;
    this.duration = timeline.duration_sec;
  }

  private remapScroll(scroll: number, range?: [number, number]): number {
    if (!range) return scroll;
    const [a, b] = range;
    if (b <= a) return 0;
    return THREE.MathUtils.clamp((scroll - a) / (b - a), 0, 1);
  }

  /** Interpolate the track at normalized playhead u∈[0,1]. */
  private evaluate(track: CameraTrack, u: number, outPos: THREE.Vector3, outTarget: THREE.Vector3): void {
    const n = track.times.length;
    if (n === 0) return;
    if (n === 1) {
      outPos.fromArray(track.position[0]);
      outTarget.fromArray(track.target[0]);
      return;
    }
    const total = track.times[n - 1] || 1;
    const tt = THREE.MathUtils.clamp(u, 0, 1) * total;
    let i = 0;
    while (i < n - 2 && track.times[i + 1] < tt) i++;
    const t0 = track.times[i];
    const t1 = track.times[i + 1];
    const segT = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
    const e = applyEasing(track.easing[i], segT);
    outPos.fromArray(track.position[i]).lerp(this._tmp.fromArray(track.position[i + 1]), e);
    outTarget.fromArray(track.target[i]).lerp(this._tmp.fromArray(track.target[i + 1]), e);
  }

  update(input: RigInput, dt: number): void {
    if (!this.track) return;

    // ── 1. playhead: scroll-scrub if bound, else auto-play ──
    const scrollBind = this.bindings.find((b) => b.event === 'scroll' && b.mode === 'scrub' && b.target === 'camera');
    let u: number;
    if (scrollBind) {
      u = this.remapScroll(input.scroll, scrollBind.range);
    } else {
      u = (input.elapsed / this.duration) % 1;
    }
    this.evaluate(this.track, u, this._pos, this._target);

    // ── 2. idle auto-orbit around the target ──
    const idleBind = this.bindings.find((b) => b.event === 'idle' && b.mode === 'auto_orbit');
    if (idleBind) {
      const angle = input.elapsed * 0.06 * idleBind.strength;
      this._pos.sub(this._target);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = this._pos.x * cos - this._pos.z * sin;
      const z = this._pos.x * sin + this._pos.z * cos;
      this._pos.x = x; this._pos.z = z;
      this._pos.add(this._target);
    }

    // ── 3. pointer micro-parallax in camera-local space ──
    const pBind = this.bindings.find((b) => b.event === 'pointer' && b.mode === 'micro_parallax');
    if (pBind) {
      // smooth the pointer so parallax feels weighty, not twitchy
      const k = 1 - Math.pow(0.0001, dt);
      this._pointerEased.x += (input.pointer.x - this._pointerEased.x) * k;
      this._pointerEased.y += (input.pointer.y - this._pointerEased.y) * k;
      this._fwd.copy(this._target).sub(this._pos).normalize();
      this._right.crossVectors(this._fwd, this._up).normalize();
      const s = pBind.strength;
      this._pos.addScaledVector(this._right, this._pointerEased.x * s);
      this._pos.addScaledVector(this._up, this._pointerEased.y * s);
    }

    // ── 4. commit ──
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._target);
    if (this.track.fov && Math.abs(this.camera.fov - this.track.fov) > 0.01) {
      this.camera.fov = this.track.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
