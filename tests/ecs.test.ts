import { describe, it, expect } from 'vitest';
import { World } from '../src/engine/ecs';

describe('ECS World', () => {
  it('creates and tracks entities', () => {
    const world = new World(100);
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    expect(e1).toBe(0);
    expect(e2).toBe(1);
    expect(world.entityCount).toBe(2);
    expect(world.isAlive(e1)).toBe(true);
  });

  it('destroys entities', () => {
    const world = new World(100);
    const e = world.createEntity();
    world.destroyEntity(e);

    expect(world.isAlive(e)).toBe(false);
    expect(world.entityCount).toBe(0);
  });

  it('throws on max entities exceeded', () => {
    const world = new World(2);
    world.createEntity();
    world.createEntity();

    expect(() => world.createEntity()).toThrow('Max entities');
  });

  it('registers and stores component data', () => {
    const world = new World(100);
    world.registerComponent('position', Float32Array, 2);

    const e = world.createEntity();
    world.set('position', e, 10.5, 20.3);

    const [x, y] = world.get('position', e);
    expect(x).toBeCloseTo(10.5);
    expect(y).toBeCloseTo(20.3);
  });

  it('handles multiple component types', () => {
    const world = new World(100);
    world.registerComponent('pos', Float32Array, 2);
    world.registerComponent('health', Float32Array, 1);

    const e = world.createEntity();
    world.set('pos', e, 5, 10);
    world.set('health', e, 100);

    expect(world.get('pos', e)).toEqual([5, 10]);
    expect(world.get('health', e)).toEqual([100]);
  });

  it('provides raw buffer for GPU upload', () => {
    const world = new World(100);
    world.registerComponent('data', Float32Array, 4);

    const e = world.createEntity();
    world.set('data', e, 1, 2, 3, 4);

    const buffer = world.getRawBuffer('data');
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(100 * 4 * 4); // 100 entities * 4 floats * 4 bytes
  });

  it('throws for unregistered component', () => {
    const world = new World(100);
    expect(() => world.get('missing', 0)).toThrow('not registered');
  });
});
