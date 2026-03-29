// Monte Carlo Battle Simulation Compute Shader
// Each invocation runs one independent battle simulation.
// Results are aggregated to produce win/loss probability distributions.

struct Unit {
  pos_x: f32,
  pos_y: f32,
  health: f32,
  max_health: f32,
  attack: f32,
  defense: f32,
  morale: f32,
  unit_type: f32, // 0=infantry, 1=archer, 2=cavalry, 3=artillery
};

struct TerrainCell {
  terrain_type: f32,
  attack_mod: f32,
  defense_mod: f32,
  morale_mod: f32,
};

struct SimParams {
  num_units_a: u32,
  num_units_b: u32,
  num_simulations: u32,
  terrain_cols: u32,
  terrain_rows: u32,
  cell_size: f32,
  rand_seed: u32,
  _padding: u32,
};

// Per-simulation result
struct SimResult {
  army_a_surviving: u32,
  army_b_surviving: u32,
  army_a_total_damage: f32,
  army_b_total_damage: f32,
};

@group(0) @binding(0) var<storage, read> params: SimParams;
@group(0) @binding(1) var<storage, read> army_a: array<Unit>;
@group(0) @binding(2) var<storage, read> army_b: array<Unit>;
@group(0) @binding(3) var<storage, read> terrain: array<TerrainCell>;
@group(0) @binding(4) var<storage, read_write> results: array<SimResult>;

// PCG random number generator - fast and high quality for GPU
fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn rand_float(seed: ptr<function, u32>) -> f32 {
  *seed = pcg_hash(*seed);
  return f32(*seed) / f32(0xFFFFFFFFu);
}

// Get terrain modifier at a world position
fn get_terrain(pos_x: f32, pos_y: f32) -> TerrainCell {
  let col = u32(pos_x / params.cell_size);
  let row = u32(pos_y / params.cell_size);
  let idx = row * params.terrain_cols + col;

  if (col < params.terrain_cols && row < params.terrain_rows) {
    return terrain[idx];
  }

  // Default: plains
  return TerrainCell(0.0, 1.0, 1.0, 1.0);
}

// Calculate distance between two units
fn distance(a: Unit, b: Unit) -> f32 {
  let dx = a.pos_x - b.pos_x;
  let dy = a.pos_y - b.pos_y;
  return sqrt(dx * dx + dy * dy);
}

// Calculate combat damage with randomized factors
fn calc_damage(
  attacker: Unit,
  defender: Unit,
  att_terrain: TerrainCell,
  def_terrain: TerrainCell,
  seed: ptr<function, u32>
) -> f32 {
  // Base damage = attack * terrain_attack_mod
  let base_attack = attacker.attack * att_terrain.attack_mod;

  // Defense reduction
  let effective_defense = defender.defense * def_terrain.defense_mod;

  // Morale factor (0.5 to 1.5 range based on morale percentage)
  let morale_factor = 0.5 + (attacker.morale / 100.0);

  // Random variance: +/- 30%
  let variance = 0.7 + rand_float(seed) * 0.6;

  // Distance penalty for melee units (infantry, cavalry)
  let dist = distance(attacker, defender);
  var range_factor = 1.0;
  if (attacker.unit_type == 0.0 || attacker.unit_type == 2.0) {
    // Melee: full damage at dist < 5, falling off to 0 at dist > 20
    range_factor = clamp(1.0 - (dist - 5.0) / 15.0, 0.0, 1.0);
  } else {
    // Ranged: optimal at 10-30, penalty outside that
    let optimal_dist = select(20.0, 35.0, attacker.unit_type == 3.0);
    range_factor = clamp(1.0 - abs(dist - optimal_dist) / optimal_dist, 0.2, 1.0);
  }

  // Cavalry charge bonus (extra damage at first strike range)
  var charge_bonus = 1.0;
  if (attacker.unit_type == 2.0 && dist > 8.0 && dist < 15.0) {
    charge_bonus = 1.5;
  }

  // Final damage calculation
  let raw_damage = base_attack * morale_factor * variance * range_factor * charge_bonus;
  let damage = max(raw_damage - effective_defense * 0.5, 1.0);

  return damage;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sim_id = gid.x;
  if (sim_id >= params.num_simulations) {
    return;
  }

  // Initialize RNG with unique seed per simulation
  var seed = params.rand_seed ^ pcg_hash(sim_id);

  // Copy unit health into local simulation state.
  // Max 96 units per side to stay within GPU register limits.
  var health_a = array<f32, 96>();
  var health_b = array<f32, 96>();

  let count_a = min(params.num_units_a, 96u);
  let count_b = min(params.num_units_b, 96u);

  for (var i = 0u; i < count_a; i++) {
    health_a[i] = army_a[i].health;
  }
  for (var i = 0u; i < count_b; i++) {
    health_b[i] = army_b[i].health;
  }

  var total_damage_to_b: f32 = 0.0;
  var total_damage_to_a: f32 = 0.0;

  // Simulate up to 50 combat rounds
  for (var round = 0u; round < 50u; round++) {
    // Count alive units
    var alive_a = 0u;
    var alive_b = 0u;
    for (var i = 0u; i < count_a; i++) {
      if (health_a[i] > 0.0) { alive_a++; }
    }
    for (var i = 0u; i < count_b; i++) {
      if (health_b[i] > 0.0) { alive_b++; }
    }

    if (alive_a == 0u || alive_b == 0u) {
      break;
    }

    // Each alive unit in A attacks a random alive unit in B
    for (var i = 0u; i < count_a; i++) {
      if (health_a[i] <= 0.0) { continue; }

      // Pick random alive target in B
      let target_roll = u32(rand_float(&seed) * f32(count_b));
      var tgt = target_roll % count_b;

      // Find next alive target
      for (var t = 0u; t < count_b; t++) {
        if (health_b[tgt] > 0.0) { break; }
        tgt = (tgt + 1u) % count_b;
      }
      if (health_b[tgt] <= 0.0) { break; }

      let att_terrain = get_terrain(army_a[i].pos_x, army_a[i].pos_y);
      let def_terrain = get_terrain(army_b[tgt].pos_x, army_b[tgt].pos_y);
      let dmg = calc_damage(army_a[i], army_b[tgt], att_terrain, def_terrain, &seed);
      health_b[tgt] -= dmg;
      total_damage_to_b += dmg;
    }

    // Each alive unit in B attacks a random alive unit in A
    for (var i = 0u; i < count_b; i++) {
      if (health_b[i] <= 0.0) { continue; }

      let target_roll = u32(rand_float(&seed) * f32(count_a));
      var tgt = target_roll % count_a;

      for (var t = 0u; t < count_a; t++) {
        if (health_a[tgt] > 0.0) { break; }
        tgt = (tgt + 1u) % count_a;
      }
      if (health_a[tgt] <= 0.0) { break; }

      let att_terrain = get_terrain(army_b[i].pos_x, army_b[i].pos_y);
      let def_terrain = get_terrain(army_a[tgt].pos_x, army_a[tgt].pos_y);
      let dmg = calc_damage(army_b[i], army_a[tgt], att_terrain, def_terrain, &seed);
      health_a[tgt] -= dmg;
      total_damage_to_a += dmg;
    }
  }

  // Count final survivors
  var surviving_a = 0u;
  var surviving_b = 0u;
  for (var i = 0u; i < count_a; i++) {
    if (health_a[i] > 0.0) { surviving_a++; }
  }
  for (var i = 0u; i < count_b; i++) {
    if (health_b[i] > 0.0) { surviving_b++; }
  }

  results[sim_id] = SimResult(surviving_a, surviving_b, total_damage_to_a, total_damage_to_b);
}
