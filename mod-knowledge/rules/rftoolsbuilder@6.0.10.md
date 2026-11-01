# RFTools family (Wave 2 unit 5) — layer-3 notes (AI consumer)

Five modules; rftoolsdim was already covered deeply in
D56 (rftoolsdim@11.0.11.json). This unit adds:

- rftoolsbuilder 6.0.10 (McJtyMods/RFToolsBuilder,
  94696e7b) — 3 rules: builder power model (1M RF
  buffer, 20000 RF/t in, 500 RF per block op, quarry
  300/block with silk x3 / fortune x2 / void x0.5
  factors), space chamber 128 limit.
- rftoolspower 6.0.3 (McJty/RFToolsPower, 49459a04) —
  3 rules: powercells 500k/4M/20M RF with 250/1000/4000
  RF/t per cell and 9x9x9 networks; coal generator
  60 RF/t, 36000 RF per coal; dimensional cells for
  cross-dimension power (1M RF per cell, x4 advanced).
- rftoolsstorage 5.0.4 (McJtyMods/RFToolsStorage,
  6eac6aa4) — 2 rules: storage modules 100/200/300/500
  stacks; remote access is RF-powered.
- rftoolsutility 6.0.7 (McJtyMods/RFToolsUtility,
  4a31a65f) — 1 rule: crafter 100 RF per operation.
- rftoolsbase 5.0.7 received NO file: it is the shared
  library under all the modules above (its content is
  exercised through them); if a base-specific question
  ever outruns this note, that is the promotion signal.

Not read: shield projector costs, spawner module
(utility) specifics, sensor/screen details, builder
shape-card geometry rules beyond the size limit.
