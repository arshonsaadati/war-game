/**
 * Procedural sound effects engine using Web Audio API.
 * All sounds are generated from oscillators and noise — no external audio files.
 */

export class SoundEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private _volume = 0.5;
  private _muted = false;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(this.ctx.destination);
  }

  /** Ensure AudioContext is resumed (must be called from a user gesture). */
  resume(): void {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Master volume 0-1. */
  get volume(): number {
    return this._volume;
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this.masterGain.gain.value = this._muted ? 0 : this._volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.masterGain.gain.value = muted ? 0 : this._volume;
  }

  /**
   * Dramatic horn/fanfare — an oscillator sweep from low to high.
   * Duration: ~0.8s
   */
  playBattleStart(): void {
    this.resume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.linearRampToValueAtTime(600, now + 0.4);
    osc.frequency.linearRampToValueAtTime(400, now + 0.8);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.setValueAtTime(0.3, now + 0.5);
    gain.gain.linearRampToValueAtTime(0, now + 0.8);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.8);
  }

  /**
   * Short impact sound — noise burst layered with a low-frequency thud.
   * Duration: ~0.15s
   */
  playCombatHit(): void {
    this.resume();
    const now = this.ctx.currentTime;

    // Noise burst
    const noiseLen = 0.1;
    const bufferSize = Math.ceil(this.ctx.sampleRate * noiseLen);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.linearRampToValueAtTime(0, now + 0.1);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noiseSrc.start(now);
    noiseSrc.stop(now + noiseLen);

    // Low thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.linearRampToValueAtTime(40, now + 0.15);
    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.linearRampToValueAtTime(0, now + 0.15);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Whooshing arrow volley — filtered noise sweep.
   * Duration: ~0.4s
   */
  playArrowVolley(): void {
    this.resume();
    const now = this.ctx.currentTime;

    const noiseLen = 0.4;
    const bufferSize = Math.ceil(this.ctx.sampleRate * noiseLen);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.linearRampToValueAtTime(500, now + 0.4);
    filter.Q.value = 2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.setValueAtTime(0.2, now + 0.2);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);

    noiseSrc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noiseSrc.start(now);
    noiseSrc.stop(now + noiseLen);
  }

  /**
   * Galloping rumble — rhythmic low-frequency pulses.
   * Duration: ~0.8s
   */
  playCavalryCharge(): void {
    this.resume();
    const now = this.ctx.currentTime;

    // 4 quick low pulses to simulate galloping
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.18;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(60 + i * 5, t);
      osc.frequency.linearRampToValueAtTime(40, t + 0.1);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.12);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /**
   * Triumphant chord — major triad (C4 E4 G4) with a bright timbre.
   * Duration: ~1.0s
   */
  playVictory(): void {
    this.resume();
    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00]; // C4, E4, G4 — major triad

    for (const freq of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.setValueAtTime(0.15, now + 0.6);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.0);
    }
  }

  /**
   * Somber descending tone — minor chord that falls in pitch.
   * Duration: ~1.0s
   */
  playDefeat(): void {
    this.resume();
    const now = this.ctx.currentTime;
    // A3, C4, E4 — A minor triad, descending
    const notes = [220.0, 261.63, 329.63];

    for (const freq of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.7, now + 1.0);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.setValueAtTime(0.12, now + 0.5);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.0);
    }
  }

  /**
   * Subtle UI click — a very short high-frequency blip.
   * Duration: ~0.05s
   */
  playUIClick(): void {
    this.resume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 1800;

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** Clean up the audio context. */
  destroy(): void {
    this.ctx.close();
  }
}
