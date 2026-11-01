# Create 6.0.8 — layer-3 notes (AI consumer)

Provenance: Creators-of-Create/Create, tag mc1.20.1-6.0.8,
commit 1a1a9a2819b4f89f78caec41b55ed8cb222fa24b. Values file:
create@6.0.8.json (same directory).

## Stress system (operational model)

- rule stress_model: actual stress of a component = impact x
  |RPM|; actual capacity of a source = capacity x |generated
  RPM|. All SU planning is: sum(impacts x rpm) <= sum(capacities
  x rpm).
- rule overstress_stops_network: exceeding capacity does not
  throttle speed; the entire connected network reads speed 0
  until load is removed or capacity added. Diagnosis order:
  check the newest added high-impact machine first.
- rule max_rotation_speed: no shaft exceeds 256 RPM (default
  config). Gear ratios cannot push a branch past 256 RPM.
- rule stress_values_are_config_defaults: per-block impact and
  capacity are server config (stressValues). Quoted defaults
  can differ on a configured server.

## Generator outputs (defaults, at full conditions)

- water wheel: 32 SU/RPM x max 8 RPM = 256 SU max.
- large water wheel: 128 SU/RPM x max 4 RPM = 512 SU max.
- windmill bearing: 512 SU/RPM; RPM = clamp(sails / 8, 1, 16);
  128 sail blocks reach 16 RPM = 8192 SU max.
- steam engine: see boiler rules; 16384 SU max per engine.
- Creative motor and hand crank values were not extracted in
  this pass.

## Boiler / steam engine (operational model)

- rule boiler_heat_levels_from_size: heat level cap =
  min(18, tank blocks / 4). A boiler needs 72 tank blocks to
  reach heat level 18.
- rule boiler_engine_efficiency: actualHeat is also capped by
  water supply (1 level per 10 water-supply units) and by the
  burners' activeHeat. Efficiency is shared: engines beyond
  actualHeat each run at actualHeat / engines efficiency.
- rule steam_engine_output: engine total output =
  efficiency x 16384 SU; the shaft spins at 16 x (1..4) RPM.
  Adding engines to an under-heated boiler lowers every
  engine's output; add heat or water first.

## Fluids and building limits

- rule fluid_tank_capacity: 8000 mB per tank block (default
  config), multiblock totals scale with block count.
- rule belt_max_length: one belt run is at most 20 blocks
  (default config); longer lines need a relay shaft or a
  second belt.
- rule blaze_burner_heat_levels: burner ladder is NONE,
  SMOULDERING, FADING, KINDLED, SEETHING. Basin recipes carry
  heatRequirement none / heated / superheated in their data;
  a recipe that does not start is checked against the burner
  level first.

## Not read in this pass

Train system numbers (schedules, fuel), contraption
assembly limits and movement settings, per-block impact table
(layer 1/2 data), fan processing durations (recipe data),
crushing/milling result chances (recipe data), sequenced
assembly, display link sources.
