/**
 * Input handling for camera control and UI interaction.
 */

import { Camera } from './camera';

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;

  // Mouse state
  private mouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  mouseX = 0;
  mouseY = 0;

  // Keyboard state
  private keysDown: Set<string> = new Set();

  // Callbacks
  onUnitClick: ((worldX: number, worldY: number) => void) | null = null;
  onBattleFieldClick: ((worldX: number, worldY: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.setup();
  }

  private setup(): void {
    // Mouse events
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch events for mobile
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd);

    // Keyboard events
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /**
   * Call each frame to process held keys for camera movement.
   */
  update(dt: number): void {
    const speed = 200 / this.camera.zoom;
    const dtSec = dt / 1000;

    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) {
      this.camera.pan(0, -speed * dtSec * this.camera.zoom);
    }
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) {
      this.camera.pan(0, speed * dtSec * this.camera.zoom);
    }
    if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) {
      this.camera.pan(speed * dtSec * this.camera.zoom, 0);
    }
    if (this.keysDown.has('d') || this.keysDown.has('arrowright')) {
      this.camera.pan(-speed * dtSec * this.camera.zoom, 0);
    }
  }

  isKeyDown(key: string): boolean {
    return this.keysDown.has(key.toLowerCase());
  }

  // --- Mouse handlers ---

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseDown = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (e.button === 0) {
      const [wx, wy] = this.camera.screenToWorld(
        e.clientX - this.canvas.getBoundingClientRect().left,
        e.clientY - this.canvas.getBoundingClientRect().top
      );
      this.onBattleFieldClick?.(wx, wy);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;

    if (this.mouseDown) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.camera.pan(dx, dy);
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  };

  private onMouseUp = (): void => {
    this.mouseDown = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.camera.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  // --- Touch handlers ---

  private lastTouchDist = 0;

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.mouseDown = true;
      this.lastMouseX = e.touches[0].clientX;
      this.lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this.lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1 && this.mouseDown) {
      const dx = e.touches[0].clientX - this.lastMouseX;
      const dy = e.touches[0].clientY - this.lastMouseY;
      this.camera.pan(dx, dy);
      this.lastMouseX = e.touches[0].clientX;
      this.lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (this.lastTouchDist > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        this.camera.zoomAt(dist / this.lastTouchDist, cx, cy);
      }
      this.lastTouchDist = dist;
    }
  };

  private onTouchEnd = (): void => {
    this.mouseDown = false;
    this.lastTouchDist = 0;
  };

  // --- Keyboard handlers ---

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keysDown.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.key.toLowerCase());
  };
}
