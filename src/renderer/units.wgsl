// Instanced unit renderer.
// Each unit is drawn as a small shape (circle approx via quad with discard).
// Instance data comes from the ECS unit buffer.

struct Uniforms {
  view_proj: mat4x4<f32>,
  time: f32,
  selected_unit: f32,
  _pad0: f32,
  _pad1: f32,
};

struct UnitInstance {
  pos_x: f32,
  pos_y: f32,
  health: f32,
  max_health: f32,
  attack: f32,
  defense: f32,
  morale: f32,
  unit_type: f32,
};

struct ArmyInfo {
  army_id: f32,
  is_alive: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) local_uv: vec2<f32>,
  @location(2) health_pct: f32,
  @location(3) is_selected: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> units: array<UnitInstance>;
@group(0) @binding(2) var<storage, read> army_info: array<ArmyInfo>;

// Unit type sizes
fn unit_size(unit_type: f32) -> f32 {
  // Infantry: small, Archer: small, Cavalry: medium, Artillery: large
  if (unit_type < 0.5) { return 0.8; }
  if (unit_type < 1.5) { return 0.7; }
  if (unit_type < 2.5) { return 1.1; }
  return 1.3;
}

// Army colors
fn army_color(army_id: f32, unit_type: f32) -> vec3<f32> {
  var base: vec3<f32>;
  if (army_id < 0.5) {
    // Army A: reds
    base = vec3<f32>(0.85, 0.2, 0.15);
  } else {
    // Army B: blues
    base = vec3<f32>(0.15, 0.25, 0.85);
  }

  // Tint by unit type
  if (unit_type < 0.5) { return base; } // infantry: pure
  if (unit_type < 1.5) { return base + vec3<f32>(0.1, 0.15, 0.0); } // archer: slightly lighter
  if (unit_type < 2.5) { return base * 1.2; } // cavalry: brighter
  return base * 0.7 + vec3<f32>(0.2, 0.2, 0.0); // artillery: tinted

}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VertexOutput {
  let unit = units[iid];
  let info = army_info[iid];

  // Skip dead units (move off-screen)
  if (info.is_alive < 0.5) {
    var out: VertexOutput;
    out.position = vec4<f32>(-999.0, -999.0, 0.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.local_uv = vec2<f32>(0.0);
    out.health_pct = 0.0;
    out.is_selected = 0.0;
    return out;
  }

  // Quad vertices for the unit sprite
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );

  let size = unit_size(unit.unit_type);
  let local = quad[vid] * size;

  // Slight morale-based bob animation
  let bob = sin(uniforms.time * 2.0 + unit.pos_x * 0.5) * 0.1 * (unit.morale / 100.0);

  let world_pos = vec2<f32>(unit.pos_x + local.x, unit.pos_y + local.y + bob);

  var out: VertexOutput;
  out.position = uniforms.view_proj * vec4<f32>(world_pos, 0.1, 1.0);
  out.color = army_color(info.army_id, unit.unit_type);
  out.local_uv = quad[vid];
  out.health_pct = unit.health / unit.max_health;
  out.is_selected = select(0.0, 1.0, f32(iid) == uniforms.selected_unit);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Circle shape via distance from center
  let dist = length(in.local_uv);
  if (dist > 1.0) {
    discard;
  }

  var color = in.color;

  // Darken based on health
  color *= 0.5 + 0.5 * in.health_pct;

  // Soft edge
  let edge = smoothstep(1.0, 0.85, dist);
  color *= edge;

  // Selection highlight ring
  if (in.is_selected > 0.5 && dist > 0.75) {
    color = vec3<f32>(1.0, 1.0, 0.3);
  }

  // Health bar (thin bar above unit)
  if (in.local_uv.y > 0.7 && in.local_uv.y < 0.9) {
    let bar_x = (in.local_uv.x + 1.0) * 0.5; // 0..1
    if (bar_x < in.health_pct) {
      // Green to red based on health
      color = mix(vec3<f32>(0.8, 0.1, 0.1), vec3<f32>(0.1, 0.8, 0.1), in.health_pct);
    } else {
      color = vec3<f32>(0.15, 0.15, 0.15);
    }
  }

  return vec4<f32>(color, 1.0);
}
