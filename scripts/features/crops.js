// Crops and soil (docs/java_spec.md §13). Bedrock random-ticks a third as often as Java, so chances are tripled.
import { world, system, ItemStack } from "@minecraft/server";
import { onBlock } from "../lib/blocks.js";
import { DIRS, add, blockAt, state, setStates, held, consumeHeld, chance, safe, randInt } from "../lib/util.js";
import { DATA } from "../generated/data.js";
import { bedrockId } from "../lib/ids.js";

const RT = 3; // random tick catch-up
const FARMLAND = new Set(["minecraft:farmland", "nookworks:nourished_soil"]);
const BONEMEALS = new Set(["minecraft:bone_meal", "nookworks:oil_cake", "nookworks:rice_bran"]);

function below(b) {
  return blockAt(b.dimension, add(b.location, DIRS.down));
}
function above(b) {
  return blockAt(b.dimension, add(b.location, DIRS.up));
}
function moist(soil) {
  try {
    return (soil.permutation.getState("moisturized_amount") ?? soil.permutation.getState("nookworks:moisture") ?? 0) > 0;
  } catch {
    return false;
  }
}
function light(b) {
  try {
    return b.dimension.getSkyLightLevel?.(b.location) ?? 15;
  } catch {
    return 15;
  }
}
/** Java's crop chance: 1 in (25 / speed + 1), speed higher on wet farmland. Nourished soil adds ticks. */
function growChance(b) {
  const soil = below(b);
  const speed = moist(soil) ? 8 : soil && FARMLAND.has(soil.typeId) ? 4 : 2;
  let c = RT / (25 / speed + 1);
  if (soil?.typeId === "nookworks:nourished_soil" && state(soil, "tilled")) c *= 1 + state(soil, "richness");
  return Math.min(1, c);
}
function useBonemeal(player, b) {
  const h = held(player);
  if (!h || !BONEMEALS.has(h.typeId)) return false;
  consumeHeld(player);
  b.dimension.spawnParticle("minecraft:crop_growth_emitter", b.center());
  b.dimension.playSound("item.bone_meal.use", b.location);
  return true;
}

// ---- simple aged crops: onions (0-7), sunflower (0-2 then a sunflower), end sprout (0-2 then a surprise)
function aged(name, max, onRipe) {
  onBlock(name, {
    randomTick: ({ block }) => {
      const soil = below(block);
      if (!soil || (!FARMLAND.has(soil.typeId) && name !== "end_sprout")) {
        block.dimension.runCommand(`setblock ${block.location.x} ${block.location.y} ${block.location.z} air destroy`);
        return;
      }
      const age = state(block, "age");
      if (age < max) {
        if (chance(growChance(block))) setStates(block, { age: age + 1 });
      } else onRipe?.(block);
    },
    interact: ({ block, player }) => {
      const age = state(block, "age");
      if (age < max && useBonemeal(player, block)) setStates(block, { age: Math.min(max, age + randInt(1, 2)) });
      else if (age >= max && onRipe && useBonemeal(player, block)) onRipe(block);
    },
  });
}
aged("onions", 7);
aged("sunflower_crop", 2, (b) => {
  const up = above(b);
  if (up?.isAir) {
    b.setType("minecraft:sunflower");
    try {
      b.setPermutation(b.permutation.withState("upper_block_bit", false));
      up.setPermutation(b.permutation.withState("upper_block_bit", true));
    } catch {}
  }
});
aged("end_sprout", 2, (b) => openEndSeed(b));

/** The End Seed opens into a plant drawn by weight from the end_seed data map. */
function openEndSeed(b) {
  const vals = DATA.dataMaps["block/end_seed"]?.values ?? {};
  const entries = Object.entries(vals).filter(([k]) => !k.startsWith("#"));
  const total = entries.reduce((s, [, v]) => s + (v.weight ?? 1), 0);
  let r = Math.random() * total;
  let pick = entries[0]?.[0];
  for (const [k, v] of entries) {
    r -= v.weight ?? 1;
    if (r < 0) {
      pick = k;
      break;
    }
  }
  if (!pick) return;
  const id = bedrockId(pick);
  const soil = below(b);
  if (soil?.typeId === "minecraft:farmland") soil.setType("minecraft:dirt");
  try {
    b.setType(id);
  } catch {
    b.setType("minecraft:poppy");
  }
  if (id.includes("corn")) {
    setStates(b, { age: 5, half: "lower" });
    const up = above(b);
    if (up?.isAir) {
      up.setType("nookworks:corn");
      setStates(up, { age: 5, half: "upper" });
    }
  }
}

// ---- corn: 0-5, two blocks tall from age 3
onBlock("corn", {
  randomTick: ({ block }) => {
    if (state(block, "half") !== "lower") return;
    const age = state(block, "age");
    if (age >= 5) return;
    if (!FARMLAND.has(below(block)?.typeId)) return;
    if (chance(growChance(block) / 2)) growCorn(block, age + 1);
  },
  interact: ({ block, player }) => {
    const lower = state(block, "half") === "upper" ? below(block) : block;
    const age = state(lower, "age");
    if (age < 5 && useBonemeal(player, lower)) growCorn(lower, age + 1);
  },
  broken: ({ block, perm }) => {
    const half = perm.getState("nookworks:half");
    const other = half === "upper" ? below(block) : above(block);
    if (other?.typeId === "nookworks:corn") other.setType("minecraft:air");
  },
});
function growCorn(lower, age) {
  if (age >= 3) {
    const up = above(lower);
    if (!up || !(up.isAir || up.typeId === "nookworks:corn")) return;
    up.setType("nookworks:corn");
    setStates(up, { half: "upper", age });
  }
  setStates(lower, { age });
}

// ---- rice: grows in water 1 deep (the block holds water), heads up into panicles; ripe panicles drop rice
onBlock("rice", {
  randomTick: ({ block }) => {
    if (!chance(RT / 5)) return;
    const age = state(block, "age");
    if (age < 3) setStates(block, { age: age + 1 });
    else {
      const up = above(block);
      if (up?.isAir) up.setType("nookworks:rice_panicles");
    }
  },
  interact: ({ block, player }) => {
    const age = state(block, "age");
    if (age < 3 && useBonemeal(player, block)) setStates(block, { age: age + 1 });
  },
  placedBy: ({ block }) => {
    // planted into the water standing on the soil
    try {
      block.setWaterlogged?.(true);
    } catch {}
  },
  broken: ({ block }) => {
    const up = above(block);
    if (up?.typeId === "nookworks:rice_panicles") up.setType("minecraft:air");
    block.setType("minecraft:water");
  },
});
onBlock("rice_panicles", {
  randomTick: ({ block }) => {
    if (below(block)?.typeId !== "nookworks:rice") return block.setType("minecraft:air");
    const age = state(block, "age");
    if (age < 3 && chance(RT / 5)) setStates(block, { age: age + 1 });
  },
  interact: ({ block, player }) => {
    const age = state(block, "age");
    if (age < 3 && useBonemeal(player, block)) setStates(block, { age: age + 1 });
  },
});

// ---- nourished soil: a hoe tills it; it loses richness slowly; dries without water like farmland
onBlock("nourished_soil", {
  interact: ({ block, player }) => {
    const h = held(player);
    if (h?.hasTag("minecraft:is_hoe") && !state(block, "tilled")) {
      setStates(block, { tilled: true });
      block.dimension.playSound("use.gravel", block.location);
    }
  },
  randomTick: ({ block }) => {
    // water within 4 keeps it moist
    let wet = false;
    for (let dx = -4; dx <= 4 && !wet; dx++)
      for (let dz = -4; dz <= 4 && !wet; dz++)
        for (let dy = 0; dy <= 1 && !wet; dy++) {
          const b = blockAt(block.dimension, { x: block.location.x + dx, y: block.location.y + dy, z: block.location.z + dz });
          if (b?.typeId === "minecraft:water") wet = true;
        }
    setStates(block, { moisture: wet ? 7 : Math.max(0, state(block, "moisture") - 1) });
    if (state(block, "tilled") && chance(0.025 * RT)) {
      const r = state(block, "richness");
      if (r > 0) setStates(block, { richness: r - 1 });
      else block.setType(state(block, "tilled") ? "minecraft:farmland" : "minecraft:dirt");
    }
  },
});

// ---- hanging planters: a plant trails down up to 3 blocks
for (const c of ["green", "pink"]) {
  onBlock(`hanging_planter_${c}`, {
    randomTick: ({ block }) => {
      if (!chance(RT / 5)) return;
      let b = below(block), n = 0;
      while (b?.typeId === `nookworks:hanging_planter_${c}_trail` && n < 3) {
        b = below(b);
        n++;
      }
      if (n < 3 && b?.isAir) {
        b.setType(`nookworks:hanging_planter_${c}_trail`);
        setStates(b, { tip: true });
        const up = above(b);
        if (up?.typeId === `nookworks:hanging_planter_${c}_trail`) setStates(up, { tip: false });
      }
    },
  });
}
