/**
 * 2D Camera with pan/zoom for the battlefield view.
 * Produces a view-projection matrix for the GPU.
 */

export class Camera {
  // World position (center of view)
  x = 0;
  y = 0;
  zoom = 1;

  // Viewport size in pixels
  viewportWidth = 800;
  viewportHeight = 600;

  // Constraints
  minZoom = 0.5;
  maxZoom = 5;
  worldBoundsMinX = -50;
  worldBoundsMinY = -50;
  worldBoundsMaxX = 250;
  worldBoundsMaxY = 250;

  // Smooth interpolation targets
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private smoothing = 0.15;

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  pan(dx: number, dy: number): void {
    // Positive dx moves the view right (camera moves left in world space)
    this.targetX -= dx / this.zoom;
    this.targetY -= dy / this.zoom;
    this.clampTarget();
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    // Compute cursor position in world space using current target state
    const ndcX = (screenX / this.viewportWidth) * 2 - 1;
    const ndcY = 1 - (screenY / this.viewportHeight) * 2;

    const halfWBefore = (this.viewportWidth / 2) / this.targetZoom;
    const halfHBefore = (this.viewportHeight / 2) / this.targetZoom;
    const worldBeforeX = this.targetX + ndcX * halfWBefore;
    const worldBeforeY = this.targetY + ndcY * halfHBefore;

    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));

    // Recompute cursor world position under new zoom and adjust so it stays fixed
    const halfWAfter = (this.viewportWidth / 2) / this.targetZoom;
    const halfHAfter = (this.viewportHeight / 2) / this.targetZoom;
    const worldAfterX = this.targetX + ndcX * halfWAfter;
    const worldAfterY = this.targetY + ndcY * halfHAfter;

    this.targetX += worldBeforeX - worldAfterX;
    this.targetY += worldBeforeY - worldAfterY;
    this.clampTarget();
  }

  setPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.x = x;
    this.y = y;
    this.clampTarget();
  }

  setZoom(z: number): void {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this.zoom = this.targetZoom;
  }

  update(): void {
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
    this.zoom += (this.targetZoom - this.zoom) * this.smoothing;
  }

  /**
   * Convert screen coordinates to world coordinates.
   */
  screenToWorld(screenX: number, screenY: number): [number, number] {
    const ndcX = (screenX / this.viewportWidth) * 2 - 1;
    const ndcY = 1 - (screenY / this.viewportHeight) * 2;

    const aspect = this.viewportWidth / this.viewportHeight;
    const halfW = (this.viewportWidth / 2) / this.zoom;
    const halfH = (this.viewportHeight / 2) / this.zoom;

    const worldX = this.x + ndcX * halfW;
    const worldY = this.y + ndcY * halfH;

    return [worldX, worldY];
  }

  /**
   * Get the view-projection matrix as a Float32Array (4x4, column-major).
   * Orthographic projection for 2D battlefield.
   */
  getViewProjectionMatrix(): Float32Array {
    const mat = new Float32Array(16);

    const halfW = (this.viewportWidth / 2) / this.zoom;
    const halfH = (this.viewportHeight / 2) / this.zoom;

    const left = this.x - halfW;
    const right = this.x + halfW;
    const bottom = this.y - halfH;
    const top = this.y + halfH;
    const near = -1;
    const far = 1;

    // Orthographic projection matrix (column-major)
    mat[0] = 2 / (right - left);
    mat[1] = 0;
    mat[2] = 0;
    mat[3] = 0;

    mat[4] = 0;
    mat[5] = 2 / (top - bottom);
    mat[6] = 0;
    mat[7] = 0;

    mat[8] = 0;
    mat[9] = 0;
    mat[10] = -2 / (far - near);
    mat[11] = 0;

    mat[12] = -(right + left) / (right - left);
    mat[13] = -(top + bottom) / (top - bottom);
    mat[14] = -(far + near) / (far - near);
    mat[15] = 1;

    return mat;
  }

  /**
   * Get visible world bounds [minX, minY, maxX, maxY].
   */
  getVisibleBounds(): [number, number, number, number] {
    const halfW = (this.viewportWidth / 2) / this.zoom;
    const halfH = (this.viewportHeight / 2) / this.zoom;
    return [this.x - halfW, this.y - halfH, this.x + halfW, this.y + halfH];
  }

  private clampTarget(): void {
    this.targetX = Math.max(this.worldBoundsMinX, Math.min(this.worldBoundsMaxX, this.targetX));
    this.targetY = Math.max(this.worldBoundsMinY, Math.min(this.worldBoundsMaxY, this.targetY));
  }
}
