import { describe, it, expect } from 'vitest';
import { Camera } from '../src/engine/camera';

describe('Camera', () => {
  it('initializes with default values', () => {
    const cam = new Camera();
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it('sets position immediately', () => {
    const cam = new Camera();
    cam.setPosition(100, 200);
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(200);
  });

  it('produces a valid 4x4 view-projection matrix', () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.setPosition(0, 0);

    const mat = cam.getViewProjectionMatrix();
    expect(mat).toBeInstanceOf(Float32Array);
    expect(mat.length).toBe(16);

    // Orthographic: mat[15] should be 1
    expect(mat[15]).toBeCloseTo(1);
    // Non-zero scale factors
    expect(mat[0]).not.toBe(0);
    expect(mat[5]).not.toBe(0);
  });

  it('zoom affects the projection', () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.setPosition(0, 0);

    const mat1 = cam.getViewProjectionMatrix();
    cam.setZoom(2);
    const mat2 = cam.getViewProjectionMatrix();

    // Zoomed in = larger scale factors
    expect(Math.abs(mat2[0])).toBeGreaterThan(Math.abs(mat1[0]));
  });

  it('returns visible bounds', () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.setPosition(100, 100);
    cam.setZoom(1);

    const [minX, minY, maxX, maxY] = cam.getVisibleBounds();
    expect(minX).toBeLessThan(100);
    expect(maxX).toBeGreaterThan(100);
    expect(minY).toBeLessThan(100);
    expect(maxY).toBeGreaterThan(100);
  });

  it('screenToWorld converts correctly at center', () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.setPosition(50, 50);
    cam.setZoom(1);

    const [wx, wy] = cam.screenToWorld(400, 300); // center of screen
    expect(wx).toBeCloseTo(50, 0);
    expect(wy).toBeCloseTo(50, 0);
  });

  it('clamps to world bounds', () => {
    const cam = new Camera();
    cam.setPosition(9999, 9999);

    // After many smoothing updates, should converge near bounds
    for (let i = 0; i < 200; i++) cam.update();

    // Allow tiny floating point overshoot from smoothing interpolation
    expect(cam.x).toBeLessThanOrEqual(cam.worldBoundsMaxX + 1);
    expect(cam.y).toBeLessThanOrEqual(cam.worldBoundsMaxY + 1);
    // But should be close to bounds, not at 9999
    expect(cam.x).toBeCloseTo(cam.worldBoundsMaxX, 0);
    expect(cam.y).toBeCloseTo(cam.worldBoundsMaxY, 0);
  });

  it('clamps zoom to valid range', () => {
    const cam = new Camera();
    cam.setZoom(0.001);
    expect(cam.zoom).toBeGreaterThanOrEqual(cam.minZoom);

    cam.setZoom(999);
    expect(cam.zoom).toBeLessThanOrEqual(cam.maxZoom);
  });
});
