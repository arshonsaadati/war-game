/**
 * Minimal Entity Component System.
 * Designed to produce flat typed arrays that map directly to GPU buffers.
 */

export type EntityId = number;

export interface ComponentStore<T extends Float32Array | Uint32Array | Int32Array> {
  data: T;
  stride: number; // elements per entity
  count: number;
}

export class World {
  private nextId = 0;
  private alive: Set<EntityId> = new Set();
  private stores: Map<string, ComponentStore<any>> = new Map();
  private maxEntities: number;

  constructor(maxEntities: number = 10000) {
    this.maxEntities = maxEntities;
  }

  createEntity(): EntityId {
    const id = this.nextId++;
    if (id >= this.maxEntities) {
      throw new Error(`Max entities (${this.maxEntities}) exceeded`);
    }
    this.alive.add(id);
    return id;
  }

  destroyEntity(id: EntityId): void {
    this.alive.delete(id);
  }

  isAlive(id: EntityId): boolean {
    return this.alive.has(id);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  registerComponent<T extends Float32Array | Uint32Array | Int32Array>(
    name: string,
    ArrayType: new (length: number) => T,
    stride: number
  ): ComponentStore<T> {
    const store: ComponentStore<T> = {
      data: new ArrayType(this.maxEntities * stride),
      stride,
      count: 0,
    };
    this.stores.set(name, store);
    return store;
  }

  getStore<T extends Float32Array | Uint32Array | Int32Array>(
    name: string
  ): ComponentStore<T> {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Component store "${name}" not registered`);
    return store;
  }

  /**
   * Set component data for an entity.
   */
  set(name: string, entityId: EntityId, ...values: number[]): void {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Component store "${name}" not registered`);
    const offset = entityId * store.stride;
    for (let i = 0; i < values.length && i < store.stride; i++) {
      store.data[offset + i] = values[i];
    }
  }

  /**
   * Get component data for an entity.
   */
  get(name: string, entityId: EntityId): number[] {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Component store "${name}" not registered`);
    const offset = entityId * store.stride;
    const result: number[] = [];
    for (let i = 0; i < store.stride; i++) {
      result.push(store.data[offset + i]);
    }
    return result;
  }

  /**
   * Get the raw typed array for GPU upload.
   */
  getRawBuffer(name: string): ArrayBufferLike {
    return this.getStore(name).data.buffer;
  }
}
