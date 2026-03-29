// Reduction shader: aggregates Monte Carlo simulation results
// into final battle statistics.

struct SimResult {
  army_a_surviving: u32,
  army_b_surviving: u32,
  army_a_total_damage: f32,
  army_b_total_damage: f32,
};

struct BattleStats {
  army_a_wins: atomic<u32>,
  army_b_wins: atomic<u32>,
  draws: atomic<u32>,
  total_sims: atomic<u32>,
  avg_a_surviving: atomic<u32>,
  avg_b_surviving: atomic<u32>,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<storage, read> results: array<SimResult>;
@group(0) @binding(1) var<storage, read_write> stats: BattleStats;
@group(0) @binding(2) var<uniform> num_sims: u32;

var<workgroup> local_a_wins: atomic<u32>;
var<workgroup> local_b_wins: atomic<u32>;
var<workgroup> local_draws: atomic<u32>;
var<workgroup> local_a_surv: atomic<u32>;
var<workgroup> local_b_surv: atomic<u32>;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  if (lid.x == 0u) {
    atomicStore(&local_a_wins, 0u);
    atomicStore(&local_b_wins, 0u);
    atomicStore(&local_draws, 0u);
    atomicStore(&local_a_surv, 0u);
    atomicStore(&local_b_surv, 0u);
  }
  workgroupBarrier();

  let idx = gid.x;
  if (idx < num_sims) {
    let result = results[idx];

    if (result.army_a_surviving > result.army_b_surviving) {
      atomicAdd(&local_a_wins, 1u);
    } else if (result.army_b_surviving > result.army_a_surviving) {
      atomicAdd(&local_b_wins, 1u);
    } else {
      atomicAdd(&local_draws, 1u);
    }

    atomicAdd(&local_a_surv, result.army_a_surviving);
    atomicAdd(&local_b_surv, result.army_b_surviving);
  }

  workgroupBarrier();

  if (lid.x == 0u) {
    atomicAdd(&stats.army_a_wins, atomicLoad(&local_a_wins));
    atomicAdd(&stats.army_b_wins, atomicLoad(&local_b_wins));
    atomicAdd(&stats.draws, atomicLoad(&local_draws));
    atomicAdd(&stats.total_sims, atomicLoad(&local_a_wins) + atomicLoad(&local_b_wins) + atomicLoad(&local_draws));
    atomicAdd(&stats.avg_a_surviving, atomicLoad(&local_a_surv));
    atomicAdd(&stats.avg_b_surviving, atomicLoad(&local_b_surv));
  }
}
