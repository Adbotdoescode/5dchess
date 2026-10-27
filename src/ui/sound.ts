// Synthesized sound effects (WebAudio). No samples: every cue is built from
// oscillators and filtered noise, so nothing is copied from the original game.

import { getSettings, subscribeSettings } from './settings'

export type SoundName = 'select' | 'move' | 'travel' | 'undo' | 'submit' | 'check' | 'end' | 'notify'

class SoundFx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null

  constructor() {
    subscribeSettings(() => this.applyVolume())
  }

  /** Create/resume the AudioContext; must run inside a user gesture at least once. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.connect(this.ctx.destination)
        this.applyVolume()
        const len = Math.floor(this.ctx.sampleRate * 1.2)
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return
    const s = getSettings()
    const v = s.sound ? Math.pow(Math.max(0, Math.min(1, s.volume)), 1.5) : 0
    this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.02)
  }

  play(name: SoundName): void {
    const s = getSettings()
    if (!s.sound || s.volume <= 0) return
    if (!this.ctx) this.unlock()
    const ctx = this.ctx
    if (!ctx || !this.master || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.005
    switch (name) {
      case 'select':
        this.tone(1250, t, 0.035, 0.08, 'sine')
        break
      case 'move':
        this.knock(t, 1)
        break
      case 'undo':
        this.knock(t, 0.6)
        this.tone(420, t, 0.09, 0.08, 'sine', 300)
        break
      case 'travel':
        this.whoosh(t)
        break
      case 'submit':
        this.tone(659.25, t, 0.5, 0.14, 'triangle')
        this.tone(987.77, t + 0.09, 0.6, 0.12, 'triangle')
        break
      case 'check':
        this.tone(466.16, t, 0.45, 0.12, 'sine')
        this.tone(493.88, t, 0.45, 0.1, 'sine')
        this.tone(233.08, t, 0.3, 0.1, 'triangle')
        break
      case 'end':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.12, 0.9 - i * 0.1, 0.12, 'triangle'))
        break
      case 'notify':
        this.tone(783.99, t, 0.25, 0.1, 'sine')
        this.tone(1046.5, t + 0.11, 0.35, 0.09, 'sine')
        break
    }
  }

  /** A short, soft tone with an exponential decay (optionally gliding to `toFreq`). */
  private tone(freq: number, t: number, dur: number, gain: number, type: OscillatorType, toFreq?: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master!)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  /** Wooden "tock": a band-passed noise click over a quick low thump. */
  private knock(t: number, level: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900
    bp.Q.value = 2.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    src.connect(bp).connect(g).connect(this.master!)
    src.start(t, Math.random() * 0.5, 0.1)
    this.tone(190, t, 0.09, 0.35 * level, 'sine', 95)
  }

  /** Time-travel whoosh: noise through a sweeping band-pass, plus a falling shimmer. */
  private whoosh(t: number): void {
    const ctx = this.ctx!
    const dur = 0.75
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    bp.frequency.setValueAtTime(300, t)
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.45)
    bp.frequency.exponentialRampToValueAtTime(500, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.4)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp).connect(g).connect(this.master!)
    src.start(t, 0, dur + 0.05)
    this.tone(880, t + 0.05, dur * 0.9, 0.05, 'sine', 330)
    this.tone(1320, t + 0.1, dur * 0.8, 0.03, 'sine', 495)
    this.knock(t + dur * 0.85, 0.7)
  }
}

export const sound = new SoundFx()
