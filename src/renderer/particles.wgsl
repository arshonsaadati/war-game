// GPU Particle System
// Compute shader updates particle positions/velocities.
// Vertex/fragment shaders render particles as glowing sprites.

// --- Compute shader: particle update ---

struct Particle {
  pos_x: f32,
  pos_y: f32,
  vel_x: f32,
  vel_y: f32,
  life: f32,       // 0..1, decreases over time
  max_life: f32,
  size: f32,
  color_r: f32,
  color_g: f32,
  color_b: f32,
  _pad0: f32,
  _pad1: f32,
};

struct ParticleParams {
  dt: f32,
  gravity_y: f32,
  drag: f32,
  num_particles: u32,
};

@group(0) @binding(0) var<uniform> params: ParticleParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn cs_update(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.num_particles) { return; }

  var p = particles[idx];

  if (p.life <= 0.0) { return; }

  // Physics update
  p.vel_y += params.gravity_y * params.dt;
  p.vel_x *= (1.0 - params.drag * params.dt);
  p.vel_y *= (1.0 - params.drag * params.dt);

  p.pos_x += p.vel_x * params.dt;
  p.pos_y += p.vel_y * params.dt;

  // Age
  p.life -= params.dt / p.max_life;

  // Fade color as life decreases
  let fade = max(p.life, 0.0);
  p.size *= (0.98 + 0.02 * fade); // slightly shrink

  particles[idx] = p;
}

// --- Render shaders ---

struct RenderUniforms {
  view_proj: mat4x4<f32>,
};

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> render_uniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> render_particles: array<Particle>;

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOutput {
  let p = render_particles[iid];

  // Skip dead particles
  if (p.life <= 0.0) {
    var out: VSOutput;
    out.position = vec4<f32>(-999.0, -999.0, 0.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.uv = vec2<f32>(0.0);
    return out;
  }

  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );

  let local = quad[vid] * p.size;
  let world = vec2<f32>(p.pos_x + local.x, p.pos_y + local.y);

  let alpha = clamp(p.life, 0.0, 1.0);

  var out: VSOutput;
  out.position = render_uniforms.view_proj * vec4<f32>(world, 0.2, 1.0);
  out.color = vec4<f32>(p.color_r, p.color_g, p.color_b, alpha);
  out.uv = quad[vid];
  return out;
}

@fragment
fn fs_main(in: VSOutput) -> @location(0) vec4<f32> {
  let dist = length(in.uv);
  if (dist > 1.0) { discard; }

  // Soft glow effect
  let glow = exp(-dist * dist * 2.0);
  let color = in.color.rgb * glow;
  let alpha = in.color.a * glow;

  return vec4<f32>(color, alpha);
}
