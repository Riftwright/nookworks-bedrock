# Nookworks (Java/NeoForge) behaviour spec, for the Bedrock port

## 0. Shared rules

### Config defaults (NookworksConfig.java, server)
- timber: enabled=true, activation=NOT_SNEAKING (also SNEAKING, ALWAYS), maxBlocks=256 (range 1-1024; extra logs, axe or Laser), fastLeafDecay=true, instantLeafDecay=false, standDownIfConflicting=true, conflictingMods list.
- veinMining: enabled=true, activation=NOT_SNEAKING, maxBlocks=64 (1-512), standDown=true.
- hammer: enabled=true, activation=NOT_SNEAKING, standDown=true (FTB Ultimine not in its conflict list).
- magnet: enabled=true, standDown=true (the Magnet Chest is not affected). buildingWand: enabled=true, standDown=true.
- machines.energyUse=1.0 (0.1-10), machines.workTime=1.0 (0.1-10), machines.generatorOutput=1.0 (0.1-10).
- elevatorRange=64 (2-384); itemWarpRange=64 (2-384); energyCableReach=512 cables (64-8192); sifterTicks=20 (1-1200; doubled with a Brass Mesh); protectTools=true; storageBreakStackLimit=256 stacks (0-1,000,000); rawFoodSickness=true; campfiresPlacedUnlit=true; recipeChoice=true; chestSortAllowed=true; playerPhotos=true; traderVillageMapChance=0.5; endSeedModFlowers=true; endSeedLeftOutMods=[].
- workTime rule (MachineTuning): a longer job keeps the same total cost, so FE/t = base / workTime. One-off costs (a plant, a felled tree, a repair step) and jobless running (barter air, laser beam, spawner control) follow energyUse only.
- Start-up config `[features]` switches off whole parts. A world's own choice is in <world>/serverconfig/nookworks-features.json. Items nothing can reach any more are hidden (part_graph.json).

### Machine base (MachineBlockEntity)
- It is a WorldlyContainer (hopper/pipe access), has an FE buffer, a redstone mode, an owner UUID, and a status line.
- Redstone modes, cycled by a GUI button (id 0): ALWAYS, WITH_SIGNAL, WITHOUT_SIGNAL (DEFAULT: runs until powered), NEVER. This is the only on/off a machine has.
- Block state `running` (bool) is the status lamp. It stays on for LAMP_HOLD=20 ticks after the last work tick. Furnace-like machines use `lit` the same way (held 20 ticks).
- General I/O pattern: inputs go in from any side except the bottom. Outputs are pulled out from the bottom only. A machine pushes its outputs into the container below (MachineIO.deliverBelow). If there is no container it drops them out where there is room; with no room they wait. After a failed push it retries every OutputRetry.BEAT=8 ticks.
- A machine broken keeps its FE, liquids and (stirring tank) catalyst in its item. A liquid-holding item stacks to 1 while it holds liquid and to 64 when empty. These items drop to a bare hand and survive explosions.
- Comparators read slot fullness. A few read a tank instead (Diesel Generator, Copper Tank).
- Claims/ownership: power, pipes, mercury and motor drive across a claim edge only where the owner could break the target. Answers are cached 5 min. This can be dropped on Bedrock or made simple.
- GUI tank gauge (GaugePouring): click a full bucket or bottle (water/oil/biodiesel 250 mB bottles; mercury bucket) on a machine screen's gauge to pour it in. An empty one draws out. Bucket = 1000 mB, bottle = 250 mB.
- Energy Cable (`energy_cable`): stores nothing. It joins cables and any energy-capable block. Power pushed in goes to every receiver on the network, up to energyCableReach cables. The network is cached until a block changes, or for 1-2 s at most.
- Sounds: an occasional vanilla-like crackle while working. No creaking wood.

### Liquids
- Liquid Experience: 20 mB = 1 XP point (ExperienceFluids.MB_PER_POINT). Bottle 250 mB (12.5 pts), bucket 1000 mB.
- Vegetable oil / biodiesel bottle = 250 mB (OilFluids.BOTTLE).
- Placed mercury (`mercury` block): poisons (100 t) and nauseates (200 t) anything living; 1 dmg/s, armour ignores it; undead take the damage only. Effects are refreshed when 20 t are left.
- Placed liquid_experience: 2 dmg every 20 t. The kill is credited to the nearest player within 32 blocks, except players, villagers and named/pet mobs.

## 1. Generators and power

**generator** (Generator). Slot 1: fuel. Fuel tank 4,000 mB of vegetable oil or biodiesel (one kind at a time), piped in.
- 40 FE/t × generatorOutput. Stores 50,000 FE. Pushes up to 200 FE/t, split evenly between receivers.
- Solid fuel: the vanilla furnace burn time (coal 1600 t = 64,000 FE). Oil or biodiesel bottle 4,000 t; bucket 16,000 t (a bucket is also furnace fuel; the bottles burn in the Generator only).
- With no item fuel it takes 15 mB "gulps" from the tank, 16 ticks/mB (640 FE/mB) for both oil and biodiesel.
- It sends first, then burns only if a whole tick's output fits. Full, it banks its fire (looks cold).
- Empties (buckets, bottles) go into the container below, else onto its top. The last of a stack stays in the slot for a hopper below to pull. Only leftovers can be pulled, from below.
- Refuses items that hold contents (a filled chest/shulker, a loaded crossbow).
- State: `lit`, `facing`. Smoke goes up a Chimney placed on it. It counts as a heat source for the pot (#heats_pots).

**diesel_generator**. Biodiesel only, 240 FE/t, 1,280 FE/mB. Tank 4,000 mB, gulp 15 mB (80 t). Stores 240,000 FE, pushes 1,200 FE/t.
- Input by pipe, by a bucket or bottle right-clicked on it (the empty goes back to the hand; other liquids are refused with a message), or by its slot (poured in as there is room; empties handled as the Generator's).
- The comparator reads the fuel tank. No light. `lit` lamp. Has an exhaust stack.

**creative_generator**. Creative players only may place it (others refused). Unbreakable in survival, no drop. Unlimited FE/t to everything joined. A redstone signal stops it. No recipe.

## 2. Processing machines (FE)

**crusher**. Slots: 0 input, 1 output. 20 FE/t, 60 t per item (1,200 FE). Buffer 10,000 FE, max in 200 FE/t. State `running`.
- Recipes: item data map `nookworks:crushing`. Key = item id or #tag; value `{result: "id" | "#tag", count?: n}`. A tag result works only if the tag has an item (vanilla's first, else the first one).
- Damageable gear gives 45% of the recipe count × durability fraction left; the fractional part is a chance of one more.
- Examples: cobblestone→gravel, gravel→sand, stone→cobblestone, logs→4 wood_chips, cobbled_deepslate→deepslate_gravel, end_stone→end_gravel, dark matter→10 black dye, charred lump→1 black dye. No ear of corn.

**electric_furnace**. Slots: 0 input, 1 output, 2 fill box (empty bucket/bottle), 3 filled. 40 FE/t. Time = vanilla smelting cookingTime / 2 (100 t for a normal 200-t recipe). Buffer 20,000 FE.
- The XP a furnace would give is kept as Liquid Experience (tank 1,000 mB). Pipes or the fill box draw it off; overflow and breaking release orbs.
- Results go below. A filled bottle only goes into a container; otherwise it waits in its slot. State `lit`. A red-hot ingot is checked fresh each time (see Quenching).

**stone_maker**. 20 FE/t, 1 cobblestone per 20 t (400 FE). Buffer 10,000. Output goes to the container below. With none it collects inside, up to 1 stack (no dropping). `running`.

**electrolytic_cell**. 80 FE/t, 100 t per run. Buffer 20,000 FE, water tank 4,000 mB (pipe or bucket), mercury buffer 4,000 mB drawn from Mercury Pipes. 1 input, 2 outputs, results below. State `lit`.
- Data map `nookworks:electrolysis`: `{result, count?=1, bonus_chance?, bonus?, water: mB, mercury?: mB lost per run, needs_mercury?: bool}`.
- needs_mercury recipes run only with ≥250 mB of mercury in the cell.
- Entries: #c:dusts/salt → caustic_soda (water 250, mercury 5, needs_mercury); #c:raw_materials/zinc → zinc_ingot (bonus_chance 0.5, water 250); every weathered copper block/statue → its unweathered form (water 50), components kept.

**laser** (`laser`, state `facing`, `beam` 0-8). Buffer 120,000 FE. Fires forward up to 8 blocks through air and anything without collision.
- Draws 400 FE/t while the beam is on. With nothing to cut it stands by at 2 FE/t with the beam off.
- Logs of a natural tree: the whole tree is felled (drops on the ground, fast leaf decay). The extra cost is 4,000 FE per fell: it waits, beam off, until the buffer has FE_PER_FELL plus one tick's worth, then fells at once. Trunk scan up to 64 down. Built logs (PlacedLogs) are left alone. Huge fungus stems are cut.
- Other flammable blocks: 30% chance per second to ignite, unless fireproof-coated.
- Living things anywhere on the beam: 4 dmg every 10 t, damage type nookworks:laser. It hurts players regardless of PvP.
- Beam drawn length held 10 t.

**planter** (`planter`, `facing`, `running`). 9 slots of seeds/saplings. 10,000 FE buffer, 20 FE per plant.
- Plants one spot every 10 t in a field 3 wide × 5 deep in front of it, at its own height (the soil is one block lower). Uses anything whose block can survive on that spot, in slot order. Air, or still water for water plants (rice).
- Hoppers fill it from any side. Nothing can be pulled out by hopper. Plants as its owner (claims). Refused spots are cached 5 min. No harvest mode.

**water_pump** (`running`). 10 FE/t, 1 bucket (1,000 mB) per 20 t from the water source below it. Tank 4,000 mB, buffer 10,000 FE.
- A source with ≥2 source neighbours (vanilla infinite rule, gamerule respected) is never used up; a lone source is drained.
- Pushes out of its top and sides into pipes, tanks and machines.

**printing_press** (`running`). Slots: 0 Fine Paper, 1-4 inks (cyan, magenta, yellow, black dye), 5 output, 6 label sample. 20 FE/t, 60 t per copy. Buffer 10,000.
- The GUI picks a design and Print makes 1 copy (the job is dropped if paper or ink runs out; it never restarts by itself).
- A poster costs 1 paper + its `inks` (default: one each of C, M, Y, K). Designs: data/<ns>/nookworks/poster/<name>.json `{asset, width, height, title?, inks?}`.
- Labels: design entry LABEL. One sheet + one of each ink makes 8 labels showing the sample item's picture (the sample stays). Letter labels need black ink only and no sample.
- Photos: entry PHOTO, from cameras the player carries. Sizes 1x1, 2x1, 1x2, 2x2, 3x2, 2x3, 3x3, 4x3 (centre crop); costs 1 sheet + 4 inks.

**compressor** (`running`). 4 input slots (0, 2, 3, 4), one kind each; slot 1 is the output. 20 FE/t, 40 t per press. Buffer 10,000.
- Takes 9 of an item → the result of the 3x3 crafting recipe whose ingredients are 9 of that item (looked up live). Never the reverse. Into an empty slot only a kind no other input holds.

**recycler** (two-high: `half` lower/upper; intake on top; `running`). Slots: 0 input, 1-2 outputs. 40 FE/t, buffer 20,000 FE, max in 400.
- Time per piece = clamp(round(15 × metal), 20, 120) ticks.
- Data map `nookworks:recycling`: `{metal: ingots (may be fractional), kind?: "scrap"(default) | "gold"}`.
- Output = 0.5 × metal × durability fraction; the fraction is a chance of +1. Scrap, or gold nuggets (×9 per ingot). Refuses items holding contents.
- Results go below the body, else on top of the intake, else beside the body.
- Scrap: 9 → scrap_bale (Compressor or crafting); smelting 1 scrap → 1 iron nugget. Sheet blocks: corrugated_sheet (rusts in 4 ages, wax/axe like copper; Wrench sneak toggles `centered`), painted variants, patched_sheet_metal.

**spawn_egg_brewer**. Slots: 0 filled Mob Bottle, 1 egg, 2 blaze powder, 3 output.
- 200 t per brew; 1 blaze powder = 10 brews. The bottle is emptied, not used up (it stays in slot 0).
- Hoppers: the top feeds bottle and egg, the sides feed blaze powder, the bottom takes spawn eggs and empty bottles. Has a redstone mode. Leftover brews are kept in the item (BREWS_LEFT).

**repair_box** (chest-like: `facing`, `type` single/left/right; two side by side join into one machine, sneak-place keeps them single). Per box: 6 slots, 20,000 FE (max in 500), Liquid XP tank 4,000 mB.
- Every 10 t it restores 5 durability to the most-worn item, for 200 FE + 20 mB (1 XP point) per step. Mending is not needed. Enchantments are kept.
- Hoppers take only finished items. Liquid XP goes in by pipe, or by a bucket/bottle clicked on it (in only; an empty container does not take any out).
- `#nookworks:not_repairable` excludes items. A pair shows 12 slots; the left half runs it.

## 3. Mercury chain
Shared base (MercuryMachineBlockEntity): slot 0 input, outputs after it go below, mercury buffer 4,000 mB, network rate 100 mB/t. Max in 500 FE/t.

**retort** (Sealed Retort; `facing`, `lit`, light 8). Slots: 0 charge, 1-2 reagents, 3-4 outputs, 5-6 fill box. 30 FE/t, 100 t per charge. Buffer 10,000 FE.
- Water tank 4,000 mB (pipe). With the charge slot empty it boils each 1,000 mB as if a water bucket were the charge.
- Keeps Liquid XP (1,000 mB) from charges and pushes it to an adjacent XP pipe/tank.
- Data map `nookworks:retorting`: `{mercury?: mB, byproduct, count, remainder?: item, reagents?: [id | #tag | list], experience: points}`. Entries:
  - minecraft:cinnabar → 250 mB mercury + 1 sulfur_dust, 0.7 XP
  - water_bucket → 2 crude_salt, remainder bucket, 0.1 XP
  - wood_chips + caustic_soda + sulfur_dust → 1 wood_pulp, 0.2 XP
  - copper_ingot + copper_ingot + #c:ingots/zinc → 3 brass_ingot, 0.5 XP
  - #logs_that_burn + glass_bottle → 1 wood_vinegar, remainder charcoal, 0.15 XP
- Bottle setting button (GUI id 1, enum RetortBottles): AUTO (default: with logs in, a hopper bottle goes to the reagents, else to the fill box) / EXPERIENCE only / WOOD_VINEGAR only.
- Mercury leaves by Mercury Pipe or into an adjacent tank. The bottom face pulls slots 3, 4 and the filled-box slot.

**stirring_tank** (`running`). 2 inputs (charge, catalyst), 1 output. 20 FE/t, 80 t per batch. Buffer 10,000.
- Tanks: oil 4,000, biodiesel 1,000, water 4,000, mercury 4,000. Water and oil go in, and biodiesel comes out, from any side; biodiesel is pushed out of the top.
  - Amalgamation: data map `nookworks:amalgamation` `{result, count, mercury: mB used}`. Ores: gold/iron ore (and deepslate) → 2 amalgam / 200 mB; copper ore → 8 / 800 mB; raw gold/iron/copper and nether gold ore → 1 / 100 mB; cobblestone, cobbled deepslate, netherrack, stone, deepslate → 1 mixed_amalgam / 50 mB. Amalgam goes below.
  - Biodiesel: methanol in the charge slot + caustic soda in the catalyst slot. Each batch turns 250 mB oil into 250 mB biodiesel. One soda serves 4 batches (the count is kept in the item as `catalyst_left`). The methanol's bottle goes below.
  - Mud: any item of #minecraft:convertable_to_mud + 250 mB piped water → mud, below.

**distiller** (Vacuum Distiller; `running`). Runs only with a complete tower: distiller + 2 `distillation_column` + `condenser` on top. 60 FE/t, 120 t per run. Buffer 20,000 FE, 4 outputs.
- Data map `nookworks:distillation`: `{result, count, bonus_chance, bonus, velarium_chance, mercury_returned}` or `{loot_table, ...}`.
  - iron_amalgam: 10 iron nuggets + 25% chance of +2, velarium 0.001, returns 90 mB
  - gold_amalgam: 20 gold nuggets + 25% chance of +5, velarium 0.001, returns 90 mB
  - copper_amalgam: 13 + 25% chance of +4, velarium 0.001, returns 90 mB
  - mixed_amalgam: a loot table, velarium 0.002, returns 45 mB
  - wood_vinegar → methanol, returns 0
- A Velarium Nugget can only come from here.

**mercury_tank**: 16,000 mB, keeps its contents when broken, 1 per stack always. **mercury_pipe**: a network walk of up to 512 pipes, cached. Producers push to consumers first, then storage; consumers pull from storage only. **mercury_bucket**: places a mercury source.

## 4. Copper fluid line (water / vegetable oil / biodiesel)
- **copper_pipe**: buffer 1,000 mB, one fluid at a time; the contents are lost when broken.
  - Each pipe has a `reach` (distance to the nearest acceptor). Fluid moves to a neighbour nearer an acceptor, all that fits, and only evens out between equal neighbours.
  - Pipes push only. With the Wrench, sneak-click a side facing a tank/machine to cycle joined → pulling → off → joined. A pulling side draws up to the buffer room per tick, only while something downstream takes it, and never pours back. A side between two pipes only toggles off/on.
  - Block states are the 6 sides plus `port_*` flags on the machines.
- **copper_tank**: 16,000 mB, one fluid. Filled from any side but the bottom. Pours down 1,000 mB/t into whatever is below.
  - Buckets and bottles by hand (in or out). Keeps its contents when broken. Comparator 0-15. Its window shows the fluid colour.
- **sight_glass** (`axis`, `level` 0-6): a pipe segment that shows the peak fill over the last 10 t. The comparator reads the same.
- **valve** (`axis`, `open`, `powered`): open when placed. An empty main hand toggles it. Redstone acts on the edge: a signal coming on opens it, going off shuts it. Shut blocks both directions.
- Pipe ports: `port_<dir>` booleans on the machines that show flanges.

## 5. Experience
- **experience_tank**: 16,000 mB (800 points). Any #c:experience fluid. A bucket (1,000) or bottle (250) fills or empties it.
  - The tap (`open`, faces whoever placed it) is turned by an empty hand on the tap part only. Open, it pours 5 points/t as orbs from the spout.
  - Comparator 0-15. Breaking it releases orbs.
- **experience_pipe**: buffer 400 mB. Same mechanics as the copper pipe, including pull sides. `filled` state for 20 t after holding XP. Wrench flush or breaking releases orbs.
- **absorption_pad** (1 px plate; `powered`; risers N/E/S/W/UP toward pipes). Buffer 2,000 mB, pushes 500 mB/t to neighbours.
  - Pulls orbs within 6 blocks. Drains a player standing on it every 4 t; each drain takes 1/5 of the player's current level's worth of points (rounded up), so about 1 level/s.
  - A redstone signal switches it off.
- **liquid_experience_bottle** on the Enchanting Table → Bottle o' Enchanting for 1 lapis and 0 levels.

## 6. Kitchen
**iron_pot** (`facing`, `lit` = heated, `cooking`, `liquid` none/water/oil, `on_grill`). 8 ingredient slots and 1,000 mB of water OR oil (never both).
- Heat: on a Grill over a lit campfire, or on a block in #nookworks:heats_pots (#fire, magma, lava, furnace, smoker, blast furnace, nookworks:generator; blocks with `lit` count only while lit), or on #conducts_heat (a hopper) over a lit fire.
- Cooking starts 40 t (SETTLE) after the last change; changing the contents restarts it.
- Interaction:
  - A matching ingredient goes in one at a time.
  - Water/oil bottle (250) or bucket (1000) pours in; an empty bottle or bucket takes it out.
  - A bowl or bottle on a ready dish takes one serving.
  - An empty hand takes the dish (or serves it into freed bowls), else shows the contents on the action bar.
  - Sneak + empty hand returns the last ingredient kind.
  - Food that no recipe takes is refused with a message.
- Hoppers/pipes: ingredients in while no dish waits, then empty bowls; out come servings (each into a bowl the pot holds), then freed containers. Never anything part-cooked.
- Broken with a dish inside, it drops the dish with its bowls.
- Recipe type `nookworks:pot`: `{ingredients:[{ingredient, count?}], liquid:"water"|"oil", amount: mB, time: ticks, container?: item, result:{id,count}}`. All recipes (data/nookworks/recipe/pot/):
  - biodiesel: 4 methanol + caustic soda, oil 1000, 300 t, glass bottle → 4 biodiesel_bottle
  - boiled_egg: #c:eggs, water 50, 300 t → 1
  - cooked_rice: white_rice, water 250, 300 t, bowl → 1
  - corn_potage: 2 #c:crops/corn + #c:crops/onion + milk bucket, water 250, 300 t, bowl → 3
  - cream_stew: milk + #c:flours/wheat + onion + potato + carrot + chicken, water 250, 400 t, bowl → 3
  - donut: 2 flour + sugar + egg, oil 100, 200 t → 4
  - french_fries: 2 potato + #c:dusts/salt, oil 50, 200 t → 2
  - fried_fish: cod, oil 50, 200 t → 1; with flour → 2
  - fried_rice: cooked_rice + egg, oil 25, 100 t, bowl → 1
  - karaage: chicken, oil 50, 200 t → 1; with flour → 2
  - soap: caustic soda, oil 250, 400 t → 2
  - stir_fried_vegetables: carrot + potato + salt, oil 25, 100 t, bowl → 1
  - tamagoyaki: 3 eggs + sugar, oil 25, 200 t → 3
  - tonkatsu: breaded_pork, oil 50, 240 t → 1
  - udon: 2 raw_udon + dried_kelp, water 500, 300 t, bowl → 2
  - vegetable_soup: potato + carrot + beetroot + salt, water 250, 300 t, bowl → 2; with onion instead of beetroot → 3
- Buff foods: Tonkatsu Haste I 3 min, Karaage Strength I 2 min, Fried Fish Water Breathing 3 min, Udon Speed I 3 min, Cream Stew Regeneration I 30 s.

**grill** (`over_fire`). Over a campfire it stands astride it, grate low; elsewhere it is a small grate table. 4 places.
- Cooks whatever the campfire recipes cook, in the same time. Done pieces stay on the grate. Off heat, a piece cools back (progress lost).
- An empty hand takes one piece (done ones first); sneak takes all.
- An Iron Pot placed on it over a fire replaces it (iron_pot with on_grill=true). Remove the campfire and the grill stands up with the pot on top.
- Hopper/pipe in/out (done pieces only). It also cooks on a hopper over a lit fire.

**nukadoko**: 4 slots. Data map `nookworks:pickling` `{result, time: ticks}`: carrot → carrot_nukazuke 12,000 t; beetroot → beetroot_nukazuke 12,000 t.
- Time passes while the chunk is unloaded (caught up from the game time). Hopper in/out (pickled only). An empty hand digs out the pickled ones (sneak: all).

**wooden_tray**: 4 places. Any food, plus #nookworks:goes_on_trays (bread_dough, risen_dough, udon_dough, raw_udon, pancake_batter, cake).
- bread_dough → risen_dough after 3,600 t (counted on the game clock, so it also rises while unloaded).
- An empty hand takes the last item (sneak: all), into the inventory, not the hand. Hopper in/out (not while rising). Breaks with the table under it.
- 3D dishes shown for udon, tonkatsu, karaage, donuts.

**plate**: one food. Food goes on; an empty hand takes it off. Breaks with its support.

**Hand machines** (worked by a handle: empty-hand right-click = 1 turn, or a Motor/Drive Wheel). Slots: 0 input, 1 output.
- Output order: container below, else container in front, else dropped just in front of the front (MachineIO.handOut). If blocked it gathers inside; when full the handle won't turn (a motor stops). A sneaking empty hand takes out what's made, or the input if nothing is made.
- Driven sides (Crankable.drivenFrom): hand_quern from above or below only; oil_press, rice_polisher and noodle_maker from the sides only.
- **hand_quern**: data map `nookworks:milling` `{result, count?, turns}`: wheat → flour (3 turns); bread → 2 breadcrumbs (2 turns).
- **noodle_maker**: `nookworks:noodle_making`: udon_dough → 2 raw_udon (4 turns).
- **rice_polisher**: any #c:crops/rice (brown rice) → white rice after 3 turns; 1 rice_bran per 4 grains. 3 slots (input, rice out, bran out).
- **oil_press** (`facing`, `oil` none/some/plenty, ports). Data map `nookworks:pressing` `{oil: mB, turns, cake: chance}`:
  - sunflower_seeds 60 mB / 2 turns / 0.25 cake
  - pumpkin_seeds 50 / 2 / 0.25
  - melon_seeds 25 / 2 / 0.25
  - corn_kernels 25 / 2 / 0.25
  - rice_bran 50 / 2 / 0.25
  - The tank is 4,000 mB. Oil runs off on its own into any adjacent pipe, tank or machine (sides and below). Bottle or bucket by hand. Oil cakes go out by handOut. Loaded with seeds by hand or hopper.
- Oil Cake and Rice Bran work as bone meal (also from a dispenser).

**Vegetable Oil Cauldron** (quenching): a cauldron of oil, 3 levels per bucket, by bucket or pipe. Rain does not fill it; it doesn't put out fire.

**Quenching**: recipe types `nookworks:heating` / `nookworks:blast_heating` (smelting/blasting) turn velarium_ingot into red_hot_velarium_ingot, stamped with the game time.
- It stays hot for 600 t. While hot, holding it burns 2 dmg (fire type, armour ignored, fire resistance blocks it) and makes the player drop it; it can't be picked up from the ground.
- Fed into the oil cauldron while hot (hopper, dropper, dispenser, or falling in) → tempered_velarium_ingot, using 1 oil level. Output goes to the container below, else onto the rim. Cooled, it is a plain ingot again.

**Food poisoning** (data map `nookworks:food_poisoning` `{chance, illness: mild|severe|parasite}`): chicken 1.0 severe, pork 0.5 severe, beef/mutton/rabbit 0.25 mild, fish 0.05 parasite.
- Strikes 1,200-2,400 t after eating, with a warning 400 t before. Milk drunk before then cures it. Creative players are exempt.

**Raw edibles**: kelp, sugar cane, sugar, salt, short grass, mushrooms, fungi, honeycomb, cocoa beans.

**Campfires placed unlit** (campfiresPlacedUnlit): flint & steel, a fire charge or a burning arrow lights them.

## 7. Sifter
**sifter**. Slot 0 input (#nookworks:siftable), slots 1-9 buffer, slot 10 Brass Mesh. No power.
- Siftable: gravel, sand, red_sand, soul_sand, crude_salt, dirt, coarse_dirt, rooted_dirt, mud, deepslate_gravel, nether_grit, end_gravel.
- Hand use: right-click holding a siftable block sifts one instantly; results pop out on top. An empty hand opens the GUI.
- Automated: one block every sifterTicks (20). With a mesh fitted it takes 40 t and uses the `sifting_fine` table where one exists.
- Results go to the container below, else drop below, else on top. They wait in the buffer, and leftovers wait hidden, so nothing is lost.
- Loot tables (type chest): `nookworks:sifting/<ns>/<path>` and `sifting_fine/<ns>/<path>`. Example: gravel has empty 315, flint 300, iron nugget 1-3 ×120, copper nugget 1-3 ×80, gold nugget 1-2 ×60, raw copper 30, raw zinc 18, raw iron 25, raw gold 10, lapis 1-2 ×15, amethyst 5, emerald 2, diamond 1, ...
- end_gravel per million rolls: nothing 797,999, chorus fruit 90,000, ender pearl 60,000, obsidian 27,000, chorus flower 20,000, shulker shell 3,000, End Seed 2,000, dragon egg 1.
- Dirt: onion and corn kernels 0.3% each, sunflower seeds as corn, brown rice 1.2%. Nether grit: ancient debris 1/990.
- Only the Sifter lets a chest under it open (non-full shape).

## 8. Motor and drive
**motor** (`facing`, `powered`). Buffer 10,000 FE, max in 200.
- The shaft faces the block it was placed against. Powered and not redstone-stopped, it always turns: 2 FE/t idle, or 20 FE/t for each machine with work (the idle cost is not added on top).
- One turn per 10 t (a quarter turn visually, 9°/t). Turns any Crankable from a side it can be driven from.
- A second motor on the same machine stands by and takes over the tick after the first stops. The Oil Can silences its hum.

**drive_wheel** (`facing`, `turning`). On a motor's shaft or against a machine's driven side.
- Belts: use a belt item on one wheel, then on a second (a started belt lapses after 600 t). Kinds: Rope (`#nookworks:drive_belt_ropes`) up to 8 blocks; Thin Chain (`#drive_belt_chains`) up to 16.
- Rules: parallel axles, the same coordinate along the axle, nothing solid on the runs or the middle line, the player may build along it. Max 2 belts per wheel. Cost: 2 items per block of length (there and back), returned when it comes off.
- Wheels end to end on one axle turn as one. One motor turns at most 8 machines (32 wheels walked), nearest first, only those with work counted, each 20 FE/t while it has power.
- A block placed in a belt's path is refused ("A drive belt runs through here"); a block pushed in snaps it (drops the rope). Sneak + empty hand on a wheel removes its belts.

## 9. Logistics and storage
- **sorter** (Item Sorter, 9 filter slots, same item) and **precision_sorter** (18 slots, plus switches: Exclude/blacklist, Exact/match components, tag entries and @mod entries from a tag picker). Block states `facing`, `gear`, `swapped`.
  - Input from the top (or any side). It also pulls from the container above like a hopper.
  - Matches leave by the right-hand outlet as seen from the front; everything else by the left (`swapped` mirrors this). Each outlet goes into the inventory on that side, else spits like a dropper. A full or blocked outlet holds the sorter (1 batch held).
  - Keep Out row: 8 ghost slots. Items listed are never drawn from above. A click on the sign flips it to "Only these" (KEEP_OUT_OTHERS).
  - Items the target can never hold (a bundle or shulker box bound for a Storage Barrel) are left above.
  - Speed by Sorter Gear (its own slot): none 8 t/1 item; gold 4 t/1; diamond 2 t/1; netherite 1 t/4; velarium 1 t/64.
- **Storage barrels** (`iron|gold|diamond|netherite|velarium_storage_barrel`; `facing` incl. up/down, `open`, `locked`):
  - iron 27 slots × 2 stacks/slot; gold 54 × 4; diamond 81 × 16; netherite 108 × 256; velarium 135 × 1024.
  - Contents spill when broken. If they exceed 256 stacks it can't be broken by hand ("中身が多すぎます。"). Removed some other way, it becomes one item with everything inside (never despawns, immune to fire, lava, explosions and cactus).
  - Refuses shulker boxes, bundles and other containers that hold items; Crates are allowed.
  - Taking out: right-click takes half (max 32); left-click a full stack (max 64); shift-click 1 stack; shift + double-click moves all of that item.
  - Sort button with orders and an asc/desc toggle (`sort_reversed`).
  - Storage upgrades (`iron..velarium_storage_upgrade`) are used on a placed barrel (iron upgrade on a vanilla barrel) to go up one tier in place.
- **crate**: 9 slots, keeps its contents when broken (loot table). No crates or shulkers inside. The filled item can't go in a crate, shulker or bundle.
- **magnet_chest**: 27 slots, pulls dropped items within a 5-block radius every 4 t. Skips the PreventRemoteMovement tag. Hoppers can empty it. No claim checks.
- **trash_can** (`powered`): accepts items only from hoppers and pipes, and only while powered. It shows as an always-empty slot and keeps a destroyed count. A hand never puts anything in.
- **item_warp_sender / item_warp_receiver**: the sender takes items dropped on top or hoppered in (1 slot) and warps them to the nearest receiver in the same column, up or down, within itemWarpRange (64), owned by the same owner (or unowned).
  - The receiver fills the container under it, else drops below (above if below is solid), checking every 8 t. If there's no receiver or room, items wait and hoppers back up. Retry is at a hopper beat (8 t).
- **horizontal_item_warp_sender / _receiver** (`facing`): sends straight ahead along its facing, at the same height, to the nearest matching receiver (same owner). The receiver outputs into the block in front of it, else drops. Recipe: the vertical one + an ender pearl. An empty hand on a receiver tells whose it is.
- **elevator** (block, feature/Elevators): standing on one, jump to go to the next elevator above, sneak to go to the one below, within elevatorRange (64).
  - The destination needs 2 free blocks of headroom; blocked ones are skipped. Carpet or snow up to 2/16 thick on it is fine; fire, lava etc. count as blocked. You arrive at the same offset, clamped half a player-width from the edge.
- **hub_stone** (`power` 0-15): a full block that carries redstone in all 6 directions. Power = the strongest neighbour signal, with a neighbouring hub stone counting one less. Strongly powers all neighbours.
- **nested_timer** (`facing` away from placer, `powered` output, `interval` 0-5 meter). The GUI sliders:
  - interval steps (t): 10, 20, 40, 60, 100, 200, 300, 400, 600, 900, 1200, 2400, 3600, 6000, 12000, 18000, 24000, 36000, 48000, 54000, 72000 (default 20)
  - pulses 1-10 (default 1)
  - gap steps (t): 10, 20, 40, 60, 100, 200, 300, 400, 600, 900, 1200 (default 20)
  - Each pulse lasts 2 t and powers only the block in front. Pulses past the end of the cycle are skipped. A signal into the back or sides holds output but the count runs on.
  - Meter bars light at intervals ≥1 s, 2 s, 5 s, 30 s, 5 min.
- **dice** (`value` 1-6, `roll` 0-4, `powered`): right-click or a redstone pulse rolls it (deterministic rigid-body tumble from a seed, about 1 s, forced to rest by 80 t).
  - The comparator reads the value, 0 while rolling. It rests off-centre and is drawn by a renderer. A dispenser throws it in from the side.
  - Dice item used in the air rolls in hand and shows the result to players within 16 blocks, at most once per second.

## 10. Spawners, mobs, villagers
- **spawner_link_sender**: placed touching spawners. Right-click it with Spawner Link Receivers to pair them (owner or operator only). Picked up and placed again, it gets a new stamp and old links die. `lit` (light 4) while a controller runs through it. Works within one dimension only.
- **spawner_link_receiver**: keeps the pairing in its item. Holds the FE: capacity 400,000, max in 20,000 FE/t. The controller sits on top.
- **spawner_controller** (`lit` while running). Every 10 t it pays and applies settings to the linked spawners.
  - Settings (SpawnerSettings): enabled; interval 20-2400 t (steps of 1 s below 10 s, 5 s above); count 1-16; maxNearby up to 64; anyLight (ignore the mob's spawn rules); needsPlayer (vanilla: a player within 16 blocks). Default: on, 200 t, 4, 6, false, true.
  - Cost per spawner per tick = max(20, round(20 × (200/4) × count / interval × (anyLight ? 2 : 1) × (needsPlayer ? 1 : 2))) × energyUse. Off costs 0.
  - Without enough power the spawner reverts to vanilla. An "off" setting is held by the spawner itself even when the controller is unloaded. A held-off spawner stops spinning and shows no flames. Has a redstone mode.
- **Spawner pickup**: a hammer with Silk Touch drops a mined spawner as an item that keeps its mob (no XP).
- **mob_bottle**: right-click a mob at ≤ half health to capture it. Not bosses, the elder guardian, the warden or vexes, nor anything without a spawn egg.
  - Saved data ≤ 64 KB. Right-click a block to release it with full NBT. Its carried equipment drops when it is brewed into an egg. No monsters released on Peaceful.
  - A villager never traded with loses its profession on release.
- **barter_terminal** (`facing`, `running`). Slots: 0 gold, 1 bottle, 2-10 outputs. 20 FE/t, buffer 20,000 (max in 200).
  - Needs a room: a 1x1 to 4x4 cuboid inside, 2-4 high, floor of #nookworks:nether_ground. A Ventilation Fan sits in the wall (guard facing in) and the terminal is against the fan's back or linked by up to 16 Ducts. Wooden or copper doors in the wall count as gaps.
  - 3 piglins per floor block (max 48). A piglin Mob Bottle in the slot releases it inside; an empty bottle takes one out.
  - Gold is handed to grown piglins with a free hand (admire 119 t). Drops on the floor are drawn into the outputs and go below. Gold and bottles go in from the top and sides; everything comes out the bottom.
  - Air lasts 6,000 t after power fails or the room breaks; making air fills the room in 15 s. Piglins in the room don't zombify (vanilla immune flag set while in air).
- **trading_counter** (no power). Slots: 9 payment (in from hoppers), 9 goods (out the bottom).
  - It serves the adult villager whose feet are in the 1x1 cell behind it. The GUI ticks trades. Every 20 t it makes the first ticked trade that's in stock, paid and has room, as a real trade (XP, level, reputation to the owner, the owner's discount).
  - Waits while the villager sleeps, a player trades by hand, under redstone, or when a claim refuses.
  - Optional "Stop when prices rise" (`pause_when_dear`).
  - Re-roll button (only for a villager with no XP at level 1, not asleep or trading; once per 10 t): new trades.
  - A villager Mob Bottle releases one behind it; an empty bottle takes it back. Collision 1.5 high (fence).

## 11. Travel, If, warp control
- **daemon_door** (Dock-a-Daemon Door, two-high sliding door) + **destination_panel** (wall; within 2 across, 1 below to 2 above the door's lower half; light 4).
  - It is a gate only when set into a wall: all 10 blocks around the doorway are full blocks (glass counts), and only entered from its front.
  - Only 1 door per dimension. The first is the home door. The panel lists the dimensions the player has visited plus the If; the choice is per player.
  - First trip: a return door is set within 16 blocks of the player's last position there, in a stone-brick frame, on a floor of its own if needed.
  - Walking into the middle of the open doorway travels; cooldown 40 t. You arrive in front of the far door facing away; a safe drop of ≤3 blocks is allowed.
  - The return door leads home. Not powered.
- **if_mirror** (2-high cheval glass): throw a Die at it 6 times (the faces become the If number, 46,656 worlds; seed hash of "nookworks:if/<number>").
  - Afterwards an empty-hand click on the glass travels. One mirror at home and one in the If.
  - The If is a vanilla-only overworld. Nether and end portals don't work there. A compass points to the mirror. Commands: /nookworks if info|home|reset.
  - Recipe: Dawnwood planks, a Die, a glass pane, a mercury bucket.
- **standing_mirror**: the same frame, plain silver glass, a real reflection (client rendering only). Clicking does nothing.
- **warp_anchor** (`on`; light 7 when on): a click toggles it. While on, teleports starting or ending inside a 9x5x9 box centred on it (±4 horizontally, ±2 vertically) are cancelled: endermen, shulkers, ender pearls, Lode Pearls, chorus fruit. Not elevators, doors or item warps.
  - Recipe: Dark Matter + 4 obsidian + 4 amethyst shards.
- **dark_matter** (`darkening`): every light lookup returns 0 in a disc of water-spread radius 7 (taxicab-like, as water flows), from 1 below to 3 above.
  - Any light-emitting block inside the disc cancels it (darkening=false). It checks every 10 t. Client-side it spreads ring by ring.
  - Recipe: charred food + an amethyst block. Crushes into 10 black dye.

## 12. Ventilation (visual only: smoke particles)
- Smoke sources: pot, grill, generator, electric furnace.
- **range_hood** captures smoke from up to 3 blocks below.
- **ventilation_fan** (`facing` toward the placer, `on`, `switched`, `powered`, `driven`): switched by a click or redstone. It draws smoke within 6 blocks in front and sends it out the back or along ducts. Driven by a Barter Terminal, it blows nether air instead.
- **duct**: a 6-side connector, followed up to 96 ducts.
- **chimney** (`top`, side collars), in brick, stone brick, nether brick and cobblestone: placed over a fire (lit campfire or furnace, running generator) it smokes by itself.
- **flue** blocks (one per chimney material): full blocks, open top and bottom only; ducts join only at top and bottom.

## 13. Crops and soil
- **corn** (planted from corn_kernels on farmland): ages 0-5, two blocks tall from age 3. Ripe (5) drops 2-4 ears; broken early it drops nothing. Bone meal advances one stage. Growth is a stage every few minutes in good light, twice as fast on wet farmland (uses NeoForge crop events). An ear crafts into 4 kernels.
- **onions** (planted from an onion on farmland, like potatoes). Returns produce like vanilla crops.
- **rice** (lower half, age 0-3): planted from brown rice in water 1 deep over dirt, grass, farmland, mud or clay, with air above. 1 in 5 random ticks grows it. It is always waterlogged (a source) and becomes water when broken.
  - At max it heads up into **rice_panicles** (age 0-3). Ripe panicles drop 2-4 brown rice (Fortune applies). The plant stays and heads up again.
- **rice_bale**: 9 white rice. Lies like hay, breaks falls like hay.
- **sunflower_crop** (from sunflower_seeds on farmland): 3 stages (BloomingCropBlock; 1/3 of random ticks are skipped), then turns into a vanilla sunflower if there's room above, otherwise it waits as a bud (no bone meal while waiting).
  - Crafting a sunflower gives yellow dye + 4 seeds (a leftover recipe).
- **end_sprout** (from end_seed, sifted from end_gravel at 1/500): 3 stages, then opens into a plant drawn from block data map `nookworks:end_seed` `{weight, properties?}`.
  - Weights: small flowers and fern 10; closed eyeblossom 6; tall flowers, large fern, flower beds, bearing sweet berry bush, bamboo, ripe corn 4; wither rose 1. Optionally other mods' #flowers too.
  - It puts dirt under plants that can't stand on farmland. Under a roof only short plants. A purple particle 1 in 24 client ticks.
- **nourished_soil** (`richness` 0-3, `tilled`, `moisture` 0-7): made from dirt + bone meal; a hoe tills it.
  - Tilled, it gives the crop above 3 extra growth ticks per random tick at full richness. 2.5% chance per random tick to lose a step (about 3 h from full to spent); then it returns to farmland or dirt.
  - Needs water within 4 like farmland. Trampling ruins it. Wood vinegar halves the decay.
- **wood_vinegar** bottle on farmland or a crop: treats a 5x5 area (±2) at the same height ±1 for 72,000 t. Rabbits avoid it; nourished soil decays at half speed.
- Drying (hung on rope, sunny time only): data map `nookworks:drying` `{result, ticks}`: kelp → dried kelp 6,000; #c:foods/raw_fish → dried_fish 12,000 (pufferfish removed).
- **hanging_planter**: a plant trails down up to 3 blocks (1/5 random ticks, or bone meal).

## 14. Lighting and decor
- **oil_lamp** (`lit`, `oil` 0-4, `burnt` 0-9): pour vegetable oil bottles in (up to 4). Light with flint & steel, a fire charge or a burning arrow; an empty hand puts it out. Light 11. One bottle burns 6,000 t in 10 steps of 600 t. Breaking it keeps the oil.
- **sconce / wall_sconce** (`lit`): a candle; light 13 when lit. Placed unlit, lit like a candle, an empty main hand snuffs it.
- **unlit_* lanterns** (10: lantern, soul, 8 copper): sneak + empty hand on a lit lantern puts it out (it swaps to the unlit block, weathering and wax kept). Flint & steel or a fire charge (any #c:tools/igniter) relights it. Copper ones weather, wax and scrape.
- **filament_bulb** (`lit`): hangs under a block, chain or rope end. An empty hand toggles it. Redstone acts on edges only (rising turns it on, falling turns it off). Light 13.
  - Hung on a rope it gives light through an invisible hung_light block that checks every 100 t. A hung bulb lights 1 s after switching on.
- **rope**: climbable. Use rope on rope to extend at the bottom; an empty hand pulls up the bottom segment. It hangs from a solid underside and falls apart when unsupported.
- **thin_rope** (`anchored` on the top segment): hangs from a ceiling like rope (not climbable). Planters, bulbs and hung items go on its end.
  - Strung between posts (#nookworks:rope_posts: fences, bars, lightning rods, end rod, hook, supports' bracket brace): use on post A, then on post B within 16 blocks. It sags 0.055 per block (min 0.04) and costs 1 Thin Rope per block.
  - Refused if anything collides along the drawn curve. A lightning strike on a rod drops the rope.
  - Redstone at a post (hasNeighborSignal, polled 5×/s) switches the lights on all its lines on edges.
- **thin_chain**: the same as a rope span (16 max), no ceiling-hanging form. Made from 3 iron nuggets → 2. Rattles and sways (client only).
- **hook** (wall or ceiling): a rope post. Sweet berries hang as a sprig (pricks and slows like the bush). Glow berries give light 14.
- **Hung things** (#nookworks:hangs_from_rope): bottles, fish, kelp, flowers, corn, berries, lanterns (#hangs_as_lantern: full block size, room 0.3 each way), heads/dragon egg (#hangs_solid, 0.5 size), banners (room 0.45, max slope 1:2), bulbs. Minimum spacing 0.4.
  - Glow berries on a rope become a cave vine that grows down up to 5 blocks total; shears stop it.
  - An empty hand takes things down. Sneak + empty hand switches bulbs and lanterns.
- **placed_bottles** (`bottles` 1-4, `filled_0..3`): sneak + use a bottle (data map `nookworks:placed_bottle` `{color?: "#rrggbb"}`) on a block top. Max 4. An empty hand takes the last back.
- **placed_books** (`books` 1-3, `standing`, `facing`, `mirrored`): sneak + use a #placeable_books item on a top (a pile) or on a wall side (leaning books, 3 max). An empty hand takes the top one.
  - **bookend** (`books` 0-5): books stand upright, 5 per block, then continue into `book_row` blocks (followed up to 256). An empty hand takes the last one. Three iron nuggets in an L → 2.
- **wine_glass / mug** (TablewareBlock `count` 1-4): stack like candles.
- **pebbles** (`pebbles` 1-4, waterlogged): from cobblestone (1 → 4; 4 → 1 back).
- Furniture per wood (all vanilla woods + poplar + dawnwood):
  - **chair**: right-click to sit (a SeatEntity at 0.42; it seats lower, down to 0.25, under a low ceiling); sneak to get up.
  - **stool**: seat 2 px lower than the chair.
  - **bench**: joins neighbours running the same way; takes the facing of the bench beside it unless sneaking.
  - **desk**: joins on 4 sides.
  - **wall_shelf** (`left`, `right`): joins side by side; its top is a full face.
  - **support** (axe cycles post → beam → bracket → wall post).
  - Wrench + sneak on a join toggles `*_apart`.
- **iron_workbench / brass_workbench**: a crafting table.
- **glazed_flower_pot**: a decorative pot.

## 15. Posters, labels, camera
- **poster** item: places a PosterEntity (W×H blocks) on a wall; a blank one can't be placed. Designs come from datapack JSON (69 shipped). The safety-cross poster has its own crafting recipe.
- **label**: pressed on a block face it becomes a LabelEntity, 8×6 px, at the pixel clicked (sneak: centred on the face). It drops when the block goes. It's placed before the block's own use, except on another label.
- **camera**: held like a spyglass; a left-click takes a 64×48 px photo. It keeps the last 9 (an unprinted one pushed out is deleted).
  - Server setting playerPhotos. Recipe: brass, brass, stone button / leather, glass, leather / 3 brass.

## 16. Tools and items with behaviour
- **Hammers** (stone, copper, iron, golden, diamond, netherite, velarium):
  - Break 3x3 in the plane facing the player, at 0.4× pickaxe speed with 4× durability; attack 4, speed -3.3.
  - Neighbours are taken only if the hammer suits them, they have no block entity, their hardness is ≤ 2× the centre's + 0.5, and they're not in #nookworks:hammer_spares (e.g. budding amethyst). Activation NOT_SNEAKING.
  - Earthmover enchantment (enchanting table and librarians): also digs shovel/axe blocks at pickaxe speed.
- **Tree felling** (timber): breaking a #logs block with an #axes tool when activation allows.
  - It is never started from, and never takes, a placed or structure log (PlacedLogs).
  - BFS over 26 neighbours for the same block, ignoring blocks below the origin, up to maxBlocks.
  - It must "look like a tree": a natural crown (#nookworks:tree_crowns = #leaves, #wart_blocks, shroomlight; leaves non-persistent) within 1 block of any log.
  - Extra blocks go through the player's break, with wear per block. protectTools stops 2 durability early.
  - Fast leaf decay: unsupported leaves (no log within 6) decay 12/tick after a 4 t delay, max 2048; with instantLeafDecay, 256/tick.
  - A Silk Touch axe drops the leaves themselves, costing 1 durability for the first and each 4th leaf. Sneak-use the axe in the air to toggle leaf gathering (`nookworks:gathers_leaves`).
  - It stands down when conflicting mods are installed. Huge fungi count too.
- **Vein mining**: breaking a block in c:ores with a pickaxe that can harvest it. The same block, or any block sharing a c:ores/* tag, BFS over 26 neighbours, max 64. Only triggers from the block the player actually broke.
- **Rootbound** (axe enchantment, level I; table and trades only): replants the felled tree with saplings from the inventory.
  - One for a 1-wide trunk, 4 for a whole 2x2 (four_only kinds need 4); 3-wide by its entry (1 middle / 9 / none).
  - Only when the cut was the bottom log, the whole tree fell (not cut short by the limit), the ground can take a sapling, and there are enough saplings. No mangroves.
  - The kind comes from block data map `nookworks:replants` `{sapling, four_only?, three_wide?, spread?, preferred?, outvotes?, ...}`, with a fallback of `<x>_leaves` → `<x>_sapling`.
  - A Rootbound axe can't strip logs.
- **magnet** (range 8) / **advanced_magnet** (range 16): stack 1; right-click toggles; works anywhere in the inventory.
  - Pulls items at 0.45 b/t and XP orbs at 0.9 b/t, line of sight only. Orbs within 2 blocks are absorbed at once (max 64/tick). Sneaking pauses it. Skips items in pickup delay and the PreventRemoteMovement tag.
- **building_wand** (durability 1024): right-click a face to copy the clicked block across the connected flat face over identical blocks. Max 32 placed, 256 visited, reach 8. Uses inventory blocks (creative needs none). Only the placement orientation is copied.
- **wrench** (durability 512):
  - Right-click rotates a block (rotate() first, then steps its facing property; up/down facings go through all 6). Sneak reverses.
  - Doesn't rotate fences, panes, walls, dust, or #wrench_ignores (dripstone, portals, dice).
  - On pipe sides it cycles pull/off. On furniture joins it toggles apart. On a corrugated sheet it toggles centred.
  - For other mods' blocks their own use goes first.
- **fine shears** (`wool_shears`, 320 durability, brass repair, enchantable 10; Fortune, Unbreaking, Mending):
  - Shear a leashed sheep without cutting the lead, plus 1 roll at 1/3 for a bonus wool and 1 more roll per Fortune level.
  - By hand a vine stops spreading. They trim cave, weeping and twisting vine and kelp tips. A dispenser shears sheep only.
- **fireproof_coating** (64 uses): use on a flammable block and it never burns. Kept by position per chunk and moves with pistons.
- **oil_can** (64): silences a door, trapdoor, gate, piston or motor (kept by position).
- **soap** (16 uses): washes dye from wool, carpet, beds, stained glass, panes and terracotta. Otherwise it removes oil or coating. In the crafting grid it unbinds a Lode Pearl.
- **lode_pearl**: use an ender pearl on a lodestone to bind it (survival or creative).
  - Thrown, it takes the thrower to the lodestone in any dimension: no fall damage, no endermite.
  - It returns to the hand if the lodestone is gone (as a plain pearl) or the trip is refused (still bound). Into the void counts as landing.
  - Lodestones are named (anvil name, else biome name numbered from the second); an empty-hand click renames (50 characters).
- **nook_dowsing_rod** (64 durability, copper repair, 3 s cooldown): finds the nearest biome in #nookworks:has_cinnabar within 6,400 blocks, spread over ticks. It points like a lodestone compass and says the distance and depth ("straight below" within 16).
  - Hidden: in the Nether the nearest fortress, in the End the nearest End city.
- **Sorter gears**: see section 9. **Storage upgrades**: see section 9.
- **Squint** (client, key C): zoom ×2 by default (1.25-4), mouse slowed by the same, with a raised-hand overlay. Not while scoping a spyglass.
- **Velarium**: tools 3400 durability / speed 11 / +5.5 damage / enchantability 18; armour durability multiplier 50, defence 4/7/9/4, toughness 4.0, knockback resistance 0.15. Tools and armour use tempered ingots on a reinforced_rod.
- **dice** item (see 10). **crate** item (see 9). **mob_bottle** (see 10).

## 17. Data maps index (all JSON `{"values": {key: value}}`; key = item id or #tag)
- item:
  - crushing `{result, count?}`
  - electrolysis `{result, count?, bonus_chance?, bonus?, water, mercury?, needs_mercury?}`
  - retorting `{mercury?, byproduct, count, remainder?, reagents?, experience}`
  - amalgamation `{result, count, mercury}`
  - distillation `{result|loot_table, count, bonus_chance, bonus, velarium_chance, mercury_returned}`
  - pressing `{oil, turns, cake}`
  - milling / noodle_making `{result, count?, turns}`
  - pickling `{result, time}`
  - drying `{result, ticks}` + top-level `remove` list
  - recycling `{metal, kind?}`
  - food_poisoning `{chance, illness}`
  - placed_bottle `{color?}`
- block:
  - end_seed `{weight, properties?}`
  - replants `{sapling, four_only?, three_wide?, ...}` (with mod_loaded conditions)
- Recipe type: `nookworks:pot` (see 6). Also nookworks:heating, nookworks:blast_heating, crafting_shapeless_leftover, and conditions nookworks:available / feature / setting.
- Loot tables: sifting/*, sifting_fine/*.
