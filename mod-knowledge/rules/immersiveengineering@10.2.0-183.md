# Immersive Engineering + Petroleum (Wave 2 unit 2) — layer-3 notes (AI consumer)

- immersiveengineering 10.2.0-183 — BluSunrize/
  ImmersiveEngineering, exact tag, e63e4824. 6 rules.
  The operational core: wire tiers (2048/8192/32768
  IF/t, loss 5 or 2.5 percent per 16 blocks), and the
  trap that connectors only move transfer/8 each
  (256/1024/4096 IF/t). Capacitors 100k/1M/4M IF.
  Diesel generator 4096 IF/t; excavator 4096 IF/t.
  Machine energy/time is recipe data x config
  modifiers, so per-recipe answers come from layer 1/2.
- immersivepetroleum 4.3.1-36b — TwistedGate/
  ImmersivePetroleum (NOT Flaxbeard's frozen repo),
  branch tip = the release commit, 5dbeb9cf. 4 rules:
  pumpjack 1024 IF/t for 15 mB/t, derrick 512 IF/t,
  oil reservoirs 2.5M-32.5M mB (weight 40), refining
  multiblocks are recipe-data driven.

Not read: IE multiblock dimensions/recipes (data),
garden cloche and lightning rod specifics, IP
lubricants and motorboat fuel specifics, reservoir
equilibrium/replenishment mechanics beyond the data
pointer.
