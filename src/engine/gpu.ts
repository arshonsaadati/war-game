/**
 * WebGPU device initialization and management.
 * Handles adapter/device acquisition with fallback detection.
 */

export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  hasTimestampQuery: boolean;
}

export async function initGPU(): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error(
      'WebGPU not supported. Try Chrome 113+ or enable chrome://flags/#enable-unsafe-webgpu'
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new Error('No WebGPU adapter found. Your GPU may not be supported.');
  }

  const hasTimestampQuery = adapter.features.has('timestamp-query');

  const requiredFeatures: GPUFeatureName[] = [];
  if (hasTimestampQuery) {
    requiredFeatures.push('timestamp-query');
  }

  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    },
  });

  device.lost.then((info) => {
    console.error(`WebGPU device lost: ${info.reason}`, info.message);
    if (info.reason !== 'destroyed') {
      // Attempt re-init
      initGPU();
    }
  });

  return { adapter, device, hasTimestampQuery };
}

/**
 * Create a GPU buffer with data.
 */
export function createBuffer(
  device: GPUDevice,
  data: ArrayBuffer | ArrayBufferView,
  usage: GPUBufferUsageFlags,
  label?: string
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.ceil(data.byteLength / 4) * 4, // align to 4 bytes
    usage,
    mappedAtCreation: true,
  });

  const dst = new Uint8Array(buffer.getMappedRange());
  dst.set(new Uint8Array('buffer' in data ? data.buffer : data));
  buffer.unmap();

  return buffer;
}

/**
 * Create an empty GPU buffer.
 */
export function createEmptyBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
  label?: string
): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.ceil(size / 4) * 4,
    usage,
  });
}

/**
 * Read back data from a GPU buffer.
 */
export async function readBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  size: number
): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const result = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();

  return result;
}
