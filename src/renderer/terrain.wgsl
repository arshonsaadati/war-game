// Terrain grid renderer.
// Each cell is a quad with color based on terrain type.

struct Uniforms {
  view_proj: mat4x4<f32>,
  grid_cols: f32,
  grid_rows: f32,
  cell_size: f32,
  time: f32,
};

struct TerrainCell {
  terrain_type: f32,
  attack_mod: f32,
  defense_mod: f32,
  morale_mod: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) world_pos: vec2<f32>,
  @location(2) cell_uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> terrain: array<TerrainCell>;

// Terrain colors
fn terrain_color(t: f32) -> vec3<f32> {
  // Plains: green
  if (t < 0.5) { return vec3<f32>(0.25, 0.45, 0.2); }
  // Forest: dark green
  if (t < 1.5) { return vec3<f32>(0.12, 0.32, 0.1); }
  // Hills: tan/brown
  if (t < 2.5) { return vec3<f32>(0.5, 0.4, 0.25); }
  // Water: blue
  if (t < 3.5) { return vec3<f32>(0.15, 0.3, 0.55); }
  // Mountains: gray
  return vec3<f32>(0.45, 0.42, 0.4);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VertexOutput {
  // Each instance is one grid cell = 2 triangles = 6 vertices
  let col = f32(iid % u32(uniforms.grid_cols));
  let row = f32(iid / u32(uniforms.grid_cols));

  // Quad vertices (2 triangles)
  var quad_pos = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
  );

  let local_pos = quad_pos[vid];
  let world_x = (col + local_pos.x) * uniforms.cell_size;
  let world_y = (row + local_pos.y) * uniforms.cell_size;

  let cell_idx = u32(row) * u32(uniforms.grid_cols) + u32(col);
  let cell = terrain[cell_idx];

  var out: VertexOutput;
  out.position = uniforms.view_proj * vec4<f32>(world_x, world_y, 0.0, 1.0);
  out.color = terrain_color(cell.terrain_type);
  out.world_pos = vec2<f32>(world_x, world_y);
  out.cell_uv = local_pos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  var color = in.color;

  // Grid lines
  let edge_dist = min(
    min(in.cell_uv.x, 1.0 - in.cell_uv.x),
    min(in.cell_uv.y, 1.0 - in.cell_uv.y)
  );
  let grid_line = smoothstep(0.0, 0.03, edge_dist);
  color = mix(color * 0.5, color, grid_line);

  return vec4<f32>(color, 1.0);
}
