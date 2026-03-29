import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoundEngine } from '../src/engine/audio';

// Mock the Web Audio API for Node.js test environment
beforeEach(() => {
  function createMockGainNode() {
    return {
      gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }

  class MockAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    resume = vi.fn();
    close = vi.fn();
    createGain = vi.fn(() => createMockGainNode());
    createOscillator = vi.fn(() => ({
      type: 'sine' as string,
      frequency: { value: 440, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createBufferSource = vi.fn(() => ({
      buffer: null as unknown,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createBiquadFilter = vi.fn(() => ({
      type: 'lowpass' as string,
      frequency: { value: 350, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      Q: { value: 1 },
      connect: vi.fn(),
    }));
    createBuffer = vi.fn((_channels: number, _length: number, _sampleRate: number) => ({
      getChannelData: vi.fn(() => new Float32Array(4410)),
    }));
  }

  vi.stubGlobal('AudioContext', MockAudioContext);
});

describe('SoundEngine', () => {
  it('can be instantiated', () => {
    const engine = new SoundEngine();
    expect(engine).toBeDefined();
    expect(engine.volume).toBe(0.5);
    expect(engine.muted).toBe(false);
  });

  it('setVolume clamps to 0-1 range', () => {
    const engine = new SoundEngine();

    engine.setVolume(0.7);
    expect(engine.volume).toBe(0.7);

    engine.setVolume(-0.5);
    expect(engine.volume).toBe(0);

    engine.setVolume(2.0);
    expect(engine.volume).toBe(1);

    engine.setVolume(0);
    expect(engine.volume).toBe(0);

    engine.setVolume(1);
    expect(engine.volume).toBe(1);
  });

  it('mute toggle works', () => {
    const engine = new SoundEngine();
    expect(engine.muted).toBe(false);

    engine.setMuted(true);
    expect(engine.muted).toBe(true);

    engine.setMuted(false);
    expect(engine.muted).toBe(false);
  });

  it('setMuted(true) preserves volume property, unmuting restores it', () => {
    const engine = new SoundEngine();
    engine.setVolume(0.8);
    expect(engine.volume).toBe(0.8);

    engine.setMuted(true);
    expect(engine.muted).toBe(true);
    // Volume property is preserved even when muted
    expect(engine.volume).toBe(0.8);

    engine.setMuted(false);
    expect(engine.muted).toBe(false);
    expect(engine.volume).toBe(0.8);
  });

  it('all sound methods can be called without throwing', () => {
    const engine = new SoundEngine();
    expect(() => engine.playBattleStart()).not.toThrow();
    expect(() => engine.playCombatHit()).not.toThrow();
    expect(() => engine.playArrowVolley()).not.toThrow();
    expect(() => engine.playCavalryCharge()).not.toThrow();
    expect(() => engine.playVictory()).not.toThrow();
    expect(() => engine.playDefeat()).not.toThrow();
    expect(() => engine.playUIClick()).not.toThrow();
  });

  it('destroy can be called', () => {
    const engine = new SoundEngine();
    expect(() => engine.destroy()).not.toThrow();
  });
});
