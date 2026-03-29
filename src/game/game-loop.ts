/**
 * Main game loop. Orchestrates simulation ticks and render frames.
 */

export type TickCallback = (dt: number, elapsed: number) => void;
export type RenderCallback = (dt: number, elapsed: number) => void;

export class GameLoop {
  private running = false;
  private lastTime = 0;
  private elapsed = 0;
  private tickRate: number; // ms between simulation ticks
  private tickAccumulator = 0;
  private onTick: TickCallback;
  private onRender: RenderCallback;
  private frameId: number = 0;

  // Performance tracking
  fps = 0;
  private frameCount = 0;
  private fpsTimer = 0;

  constructor(
    tickRate: number,
    onTick: TickCallback,
    onRender: RenderCallback
  ) {
    this.tickRate = tickRate;
    this.onTick = onTick;
    this.onRender = onRender;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  stop(): void {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }
  }

  private loop = (now: number): void => {
    if (!this.running) return;

    const dt = now - this.lastTime;
    this.lastTime = now;
    this.elapsed += dt;

    // FPS counter
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    // Fixed timestep simulation ticks
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= this.tickRate) {
      this.onTick(this.tickRate, this.elapsed);
      this.tickAccumulator -= this.tickRate;
    }

    // Render every frame
    this.onRender(dt, this.elapsed);

    this.frameId = requestAnimationFrame(this.loop);
  };
}
