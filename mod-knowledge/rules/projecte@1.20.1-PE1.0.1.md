# ProjectE 1.20.1-PE1.0.1 — notes for the LLM

Source: sinkillerj/ProjectE @ 68fbb2dea0cf8a6394fa6c7c084063046d94cee5
(branch `mc1.20.x` — the PE1.0.1 release commit; ProjectE publishes no
version tags, so layer 3 pins release commits on the per-MC branch).
Machine-readable values: `projecte@1.20.1-PE1.0.1.json` (same directory).

## What this unblocks (aibou-mc D22)

The `transmute` skill design no longer needs to guess the
transmutation table GUI:

- Container slots, in order: **0–7 input (learn)**, **8 lock**,
  **9 consume**, **10 unlearn**, **11–26 outputs** (16 shown learned
  items, paged/scrolled by search), then the player inventory.
- Putting an item with an EMC value into an input slot teaches it to
  the *bot player* immediately; the item is **not** consumed and can
  be taken back. Only items with EMC > 0 can be learned.
- Slot 9 (consume) burns stacks: it teaches the item too, and adds
  `sell value × count` to the bot's knowledge EMC pool. Default
  sell value = full EMC (config `difficulty.covalenceLoss` = 1.0).
- Taking a learned item from an output slot spends EMC from that same
  pool. The pool is a BigInteger — no practical cap.
- Learning EMC holders (Klein Stars) in an input slot also drains
  their stored EMC into the pool (SlotInput.set handles
  IItemEmcHolder) — useful for emptying stars.
- The Tome of Knowledge, once learned, sets `fullKnowledge` — from
  then on every EMC-bearing item counts as known.

Practical shape for the skill (still needs live GUI verification):
open table → click items from bot inventory into slots 0–7 to learn →
use slot 9 to burn surplus for EMC → take items from the output slots
(SlotOutput.remove deducts the EMC server-side).

Getting the wanted item INTO an output slot is the subtle part. The
ring is a client-side view: learned items, EMC descending, costing
more than the pool hidden, 16 per view. Three ways to surface a
target:
- **Lock shortcut**: put a sample of the target in the lock slot (8)
  and it is pinned to output slot 0 (or the fuel slot) — no paging.
- **Paging**: the GUI's < / > buttons step `searchpage` (12 entries
  per step). Cheap staples (cobblestone EMC 1) sit on the LAST page,
  so a well-taught bot needs many clicks this way; the bridge's
  `screen` click tool can press the buttons.
- **Search filter**: the GUI's text box sets `filter` (name
  substring) and resets the page — the precise route, but the bridge
  has no text-typing op yet; setting the public `filter`/`searchpage`
  fields on the bot's client inventory via a small mod-side helper
  (reflection, like projecte.status) is the candidate design when
  the transmute skill is built.

## EMC economics in one paragraph

Values are *computed*, not listed: a graph mapper starts from seed
values (`defaults.json`: diamond 8192, emerald 16384, nether star
139264, lapis 864, blaze rod 1536, ender pearl 1024, coal 128,
redstone dust 64, glowstone dust 384, logs 32, cobblestone/dirt/sand
1) and propagates through recipes and conversions. Ingots therefore
cost exactly their production inputs (e.g. an iron ingot = raw iron
value = ore-derived). Anything without a value (> 0) is outside the
transmutation economy: it cannot be learned, burned, or produced.

Passive generation is slow by design: collectors make 4 / 12 / 40
EMC per tick-unit at MK1/2/3 (storage 10k/30k/60k); relays move
64 / 192 / 640 (storage 100k/1M/10M). Klein Star capacities:
50k, 200k, 800k, 3.2M, 12.8M, 51.2M. A condenser converts any input
items into one locked target whenever its stored EMC covers the
target's value — it is an EMC *reshaper*, not a generator.

## Cautions for the companion

- Knowledge and the EMC pool belong to the **bot player**, not the
  human player. Burning the bot's items builds the bot's pool.
- The consume slot is destructive and instant on placement — treat
  slot 9 like the `toss` class of operations (approval gate) in any
  future skill.
- EMC values can be re-mapped by datapacks on a given server; treat
  the numbers here as defaults, and prefer live `projecte_status`
  readings when they disagree.
