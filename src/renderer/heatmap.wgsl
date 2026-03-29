// Heatmap overlay renderer.
// Visualizes Monte Carlo win probability across the battlefield.
// Red = Army A advantage, Blue = Army B advantage, neutral = gray.

struct Uniforms {
  view_proj: mat4x4<f32>,
  grid_cols: f32,
  grid_rows: f32,
  cell_size: f32,
  opacity: f32,
};

// Per-cell heatmap data: [probability_a, probability_b, intensity, unused]
struct HeatmapCell {
  prob_a: f32,
  prob_b: f32,
  intensity: f32,
  _pad: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) heat_color: vec4<f32>,
  @location(1) cell_uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> heatmap: array<HeatmapCell>;

fn heat_to_color(prob_a: f32, prob_b: f32, intensity: f32) -> vec4<f32> {
  // Blend between red (A advantage) and blue (B advantage)
  let advantage = prob_a - prob_b; // -1 to 1

  var color: vec3<f32>;
  if (advantage > 0.0) {
    // Red tones for A
    color = mix(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.9, 0.15, 0.1), advantage);
  } else {
    // Blue tones for B
    color = mix(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.1, 0.2, 0.9), -advantage);
  }

  let alpha = intensity * uniforms.opacity;
  return vec4<f32>(color, alpha);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VertexOutput {
  let col = f32(iid % u32(uniforms.grid_cols));
  let row = f32(iid / u32(uniforms.grid_cols));

  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
  );

  let local = quad[vid];
  let world_x = (col + local.x) * uniforms.cell_size;
  let world_y = (row + local.y) * uniforms.cell_size;

  let cell = heatmap[iid];

  var out: VertexOutput;
  out.position = uniforms.view_proj * vec4<f32>(world_x, world_y, 0.05, 1.0);
  out.heat_color = heat_to_color(cell.prob_a, cell.prob_b, cell.intensity);
  out.cell_uv = local;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Soft edges within cell
  let edge = min(
    min(in.cell_uv.x, 1.0 - in.cell_uv.x),
    min(in.cell_uv.y, 1.0 - in.cell_uv.y)
  );
  let soft = smoothstep(0.0, 0.15, edge);

  var color = in.heat_color;
  color.a *= soft;

  return color;
}
