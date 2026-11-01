# Twilight Forest — 4.3.2508 — notes for the LLM

Source: TeamTwilight/TwilightForest @
1bc3a4c21213bc443967e92125613cb9ef47891e (branch `1.20.1` tip at
extraction; TF ships CI build numbers, not tags — see the JSON's
source_ref). Machine-readable values: `twilightforest@4.3.2508.json`.

## The progression is a per-player ladder, and the bot is on it too

Chain: **Naga → Lich → (eat Meef Stroganoff) → Hydra**, with
branches from Lich: **Alpha Yeti → Snow Queen**, **Phantom Knights**
(all of them, after placing a trophy on the stronghold pedestal),
**Ur-Ghast**, then **merge** (Hydra + Ur-Ghast + Snow Queen) for the
Highlands, and the **Lamp of Cinders** line for the Thornlands and
Final Plateau.

Two facts that shape how the companion should behave:

1. **Progression is personal.** Every player — including the bot —
   needs their *own* kill credit (the killing blow), their own
   trophy and key item in inventory, and must have hurt the boss
   during the fight. If the bot lands the killing blow on a
   progression boss, the human gets *nothing* from that kill.
   Companion rule: on progression bosses, fight supportively —
   clear adds, hold aggro, damage — but **leave the final blow to
   the player** until the player's progression is secured.
2. **Locks are enforced on bodies, not on the world.** Biomes punish
   players who lack the advancement (the swamp starves you until
   the Lich falls; the Fire Swamp sets you on fire 8 s at a time
   until you've eaten the stroganoff; the Highlands rain acid until
   the merge). Structures refuse digging/interaction per player
   (the Lich Tower wants progress_naga). The bot suffers all of
   this on its own account: it cannot scout the Fire Swamp safely
   before the stroganoff step, and it cannot dig the player into a
   sealed structure.

## Practical sequencing for a joint run

- Before entering a new biome, check which advancement it wants
  (the JSON's biome_restrictions table) against BOTH players'
  progression — the stricter of the two governs the trip.
- Meef Stroganoff is not food, it's a key: it drops from the
  Minoshroom in the Labyrinth (which sits behind the Lich), and
  eating it is what opens the Hydra's Fire Swamp. Carry it, don't
  snack it early.
- The trophy pedestal in the Goblin Knight Stronghold needs a boss
  trophy placed on it (any earlier boss works) before the Knights'
  vault opens.
- Quest-boss order for FTB Quests / dimension_profile notes:
  overworld-side preparation (magic map focus, charms of keeping)
  is un-gated; everything past the Lich branches, so plan the Lich
  kill as the first joint expedition.
