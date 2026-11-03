// Generators and the FE machines (docs/java_spec.md §1-2), on the framework in lib/machine.js.
// Times are counted in game ticks; work() runs every TICK (10) ticks and does TICK ticks' worth.
import { defineMachine, useEnergy, putOut, spaceFor } from "../lib/machine.js";
import { TICK } from "../lib/blocks.js";
import { DATA } from "../generated/data.js";
import { dataMapLookup, bedrockId, matches, tagItems } from "../lib/ids.js";
import { roll } from "../lib/loot.js";
import { fill, drain, pushFluid } from "../lib/fluids.js";
import { setting } from "./settings.js";
import { DIRS, add, blockAt, facing, isCreative, tr, randInt } from "../lib/util.js";
import { takeFromSlot } from "../lib/inv.js";
import { ItemStack } from "@minecraft/server";

const dm = (n) => DATA.dataMaps[`item/${n}`];
const E = (n) => Math.ceil(n * setting("machineEnergy"));       // FE per tick, after the setting
const T = (n) => Math.max(1, Math.round(n * setting("machineTime")));
const G = (n) => n * setting("generatorOutput");

// ---- fuel (Bedrock has no furnace fuel lookup for scripts; vanilla's burn times)
const FUEL = {
  "minecraft:coal": 1600, "minecraft:charcoal": 1600, "minecraft:coal_block": 16000, "minecraft:blaze_rod": 2400,
  "minecraft:lava_bucket": 20000, "minecraft:dried_kelp_block": 4001, "minecraft:stick": 100, "minecraft:bamboo": 50,
  "minecraft:scaffolding": 50, "minecraft:bowl": 100, "nookworks:vegetable_oil_bottle": 4000, "nookworks:biodiesel_bottle": 4000,
  "nookworks:vegetable_oil_bucket": 16000, "nookworks:biodiesel_bucket": 16000, "nookworks:wood_chips": 100,
  "nookworks:oil_cake": 400, "minecraft:crafting_table": 300, "minecraft:chest": 300, "minecraft:barrel": 300,
};
export function burnTime(id) {
  if (FUEL[id]) return FUEL[id];
  if (/(_planks|_log|_wood|_stem|_hyphae|_fence|_fence_gate|_slab|_stairs|_trapdoor|_pressure_plate)$/.test(id) && !/crimson|warped/.test(id))
    return /_slab$/.test(id) ? 150 : 300;
  if (/^minecraft:wooden_(sword|pickaxe|axe|shovel|hoe)$/.test(id)) return 200;
  if (/_sapling$|_button$|_door$|_sign$/.test(id)) return /door|sign/.test(id) ? 200 : 100;
  if (/_wool$|_carpet$/.test(id)) return /carpet/.test(id) ? 67 : 100;
  return 0;
}
const EMPTY_OF = { "minecraft:lava_bucket": "minecraft:bucket", "nookworks:vegetable_oil_bucket": "minecraft:bucket",
  "nookworks:biodiesel_bucket": "minecraft:bucket", "nookworks:vegetable_oil_bottle": "minecraft:glass_bottle",
  "nookworks:biodiesel_bottle": "minecraft:glass_bottle" };

// ---- Generator: 40 FE/t, 50,000 FE, pushes 200 FE/t; solid fuel or 15 mB gulps of oil/biodiesel (16 t per mB)
defineMachine("generator", {
  slots: 2, inputs: [0], outputs: [1],
  energy: { cap: 50000, out: 200 },
  tanks: { fuel: { cap: 4000, accepts: (f) => f === "vegetable_oil" || f === "biodiesel" } },
  accepts: (d, p) => burnTime(p.id) > 0,
  work({ d }) {
    const per = G(40);
    if (d.fe + per * TICK > 50000 && !d.burn) return "full";
    if (!d.burn) {
      const s = d.slots[0];
      if (s && burnTime(s.id)) {
        d.burn = d.burnMax = burnTime(s.id);
        takeFromSlot(d.slots, 0, 1);
        if (EMPTY_OF[s.id]) putOut(d, 1, { id: EMPTY_OF[s.id], n: 1 });
      } else if (d.tanks.fuel.n >= 15) {
        drain(d.tanks.fuel, 15);
        d.burn = d.burnMax = 15 * 16;
      } else return "no_fuel";
    }
    const t = Math.min(TICK, d.burn);
    d.burn -= t;
    d.fe = Math.min(50000, d.fe + per * t);
    return "running";
  },
  lines: ({ d }) => (d.burn ? [tr("nookworks.bedrock.burning", `${Math.ceil(d.burn / 20)}s`)] : []),
});

// ---- Diesel Generator: biodiesel only, 240 FE/t, 1,280 FE/mB (15 mB gulp = 80 t), 240,000 FE, pushes 1,200 FE/t
defineMachine("diesel_generator", {
  slots: 2, inputs: [0], outputs: [1],
  energy: { cap: 240000, out: 1200 },
  tanks: { fuel: { cap: 4000, accepts: (f) => f === "biodiesel" } },
  accepts: (d, p) => p.id === "nookworks:biodiesel_bucket" || p.id === "nookworks:biodiesel_bottle",
  work({ d }) {
    const s = d.slots[0];
    if (s) {
      const n = s.id.endsWith("_bucket") ? 1000 : 250;
      if (4000 - d.tanks.fuel.n >= n) {
        fill(d.tanks.fuel, 4000, "biodiesel", n);
        takeFromSlot(d.slots, 0, 1);
        putOut(d, 1, { id: EMPTY_OF[s.id], n: 1 });
      }
    }
    const per = G(240);
    if (d.fe + per * TICK > 240000) return "full";
    if (!d.burn) {
      if (d.tanks.fuel.n < 15) return "no_fuel";
      drain(d.tanks.fuel, 15);
      d.burn = 80;
    }
    const t = Math.min(TICK, d.burn);
    d.burn -= t;
    d.fe = Math.min(240000, d.fe + per * t);
    return "running";
  },
});

// ---- Creative Generator: endless power to everything joined
defineMachine("creative_generator", {
  energy: { cap: 2e9, out: 1e8 },
  work({ d }) {
    d.fe = 2e9;
    return "running";
  },
  place: ({ block, previous }) => {},
});

// ---- simple one-in one-out processors
function processor(name, { fe, ticks, cap = 10000, recipe, accepts }) {
  return defineMachine(name, {
    slots: 2, inputs: [0], outputs: [1], energy: { cap, in: true },
    progressMax: () => T(ticks),
    accepts: (d, p) => !!recipe(p.id, d),
    work({ d }) {
      const s = d.slots[0];
      const r = s && recipe(s.id, d);
      if (!r) {
        d.progress = 0;
        return "idle";
      }
      if (d.slots[1] && !(d.slots[1].id === r.id && d.slots[1].n + r.n <= 64)) return "blocked";
      const cost = E(fe) * TICK;
      if (!useEnergy(d, cost)) return "no_power";
      d.progress += TICK;
      if (d.progress >= T(ticks)) {
        d.progress = 0;
        takeFromSlot(d.slots, 0, 1);
        const out = typeof r.make === "function" ? r.make() : r;
        if (out.n > 0) putOut(d, 1, { id: out.id, n: out.n });
      }
      return "running";
    },
  });
}

function crushResult(id) {
  const v = dataMapLookup(dm("crushing"), id);
  if (!v) return null;
  let r = v.result;
  if (r.startsWith("#")) r = [...tagItems(r.slice(1))][0];
  return { id: bedrockId(r), n: v.count ?? 1 };
}
processor("crusher", { fe: 20, ticks: 60, recipe: crushResult });

processor("electric_furnace", {
  fe: 40, ticks: 100, cap: 20000,
  recipe: (id) => {
    const r = DATA.smelting[id];
    return r ? { id: r[0], n: 1 } : null;
  },
});

// ---- Stone Maker: 1 cobblestone per 20 t at 20 FE/t
defineMachine("stone_maker", {
  slots: 1, outputs: [0], energy: { cap: 10000, in: true }, keepOutputs: true,
  work({ d }) {
    if (d.slots[0]?.n >= 64) return "blocked";
    if (!useEnergy(d, E(20) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= T(20)) {
      d.progress = 0;
      putOut(d, 0, { id: "minecraft:cobblestone", n: 1 });
    }
    return "running";
  },
});

// ---- Compressor: nine of a thing into its 3x3 block, 40 t at 20 FE/t
defineMachine("compressor", {
  slots: 5, inputs: [0, 2, 3, 4], outputs: [1], energy: { cap: 10000, in: true }, progressMax: () => T(40),
  accepts: (d, p, i) => !!DATA.crafting9[p.id] && (d.slots[i]?.id === p.id || !d.slots.some((s, j) => j !== i && j !== 1 && s?.id === p.id)),
  work({ d }) {
    const i = [0, 2, 3, 4].find((j) => d.slots[j]?.n >= 9 && DATA.crafting9[d.slots[j].id]);
    if (i === undefined) {
      d.progress = 0;
      return "idle";
    }
    const [rid, rn] = DATA.crafting9[d.slots[i].id];
    if (!spaceFor(d, 1, { id: rid, n: rn })) return "blocked";
    if (!useEnergy(d, E(20) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= T(40)) {
      d.progress = 0;
      takeFromSlot(d.slots, i, 9);
      putOut(d, 1, { id: rid, n: rn });
    }
    return "running";
  },
});

// ---- Recycler: half the metal back as scrap (or gold nuggets), scaled by wear
defineMachine("recycler", {
  slots: 3, inputs: [0], outputs: [1, 2], energy: { cap: 20000, in: true },
  accepts: (d, p) => !!dataMapLookup(dm("recycling"), p.id),
  progressMax: ({ d }) => (d.slots[0] ? recycleTime(d.slots[0].id) : 0),
  work({ d }) {
    const s = d.slots[0];
    const v = s && dataMapLookup(dm("recycling"), s.id);
    if (!v) {
      d.progress = 0;
      return "idle";
    }
    if (d.slots[1] && d.slots[2]) return "blocked";
    if (!useEnergy(d, E(40) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= recycleTime(s.id)) {
      d.progress = 0;
      let frac = 1;
      if (s.dmg) {
        try {
          const max = new ItemStack(s.id).getComponent("minecraft:durability")?.maxDurability;
          if (max) frac = Math.max(0, 1 - s.dmg / max);
        } catch {}
      }
      let amount = 0.5 * v.metal * frac * (v.kind === "gold" ? 9 : 1);
      let n = Math.floor(amount) + (Math.random() < amount % 1 ? 1 : 0);
      takeFromSlot(d.slots, 0, 1);
      if (n > 0) putOut(d, [1, 2], { id: v.kind === "gold" ? "minecraft:gold_nugget" : "nookworks:scrap", n });
    }
    return "running";
  },
});
function recycleTime(id) {
  const v = dataMapLookup(dm("recycling"), id);
  return T(Math.min(120, Math.max(20, Math.round(15 * (v?.metal ?? 1)))));
}

// ---- Electrolytic Cell: 80 FE/t, 100 t per run; water (and mercury for some)
defineMachine("electrolytic_cell", {
  slots: 3, inputs: [0], outputs: [1, 2], energy: { cap: 20000, in: true }, progressMax: () => T(100),
  tanks: { water: { cap: 4000, accepts: (f) => f === "water" }, mercury: { cap: 4000, accepts: (f) => f === "mercury" } },
  accepts: (d, p) => !!dataMapLookup(dm("electrolysis"), p.id),
  work({ d }) {
    const s = d.slots[0];
    const v = s && dataMapLookup(dm("electrolysis"), s.id);
    if (!v) {
      d.progress = 0;
      return "idle";
    }
    if (d.tanks.water.n < (v.water ?? 0)) return "no_fluid";
    if (v.needs_mercury && d.tanks.mercury.n < 250) return "no_fluid";
    if (d.slots[1] && d.slots[2]) return "blocked";
    if (!useEnergy(d, E(80) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= T(100)) {
      d.progress = 0;
      drain(d.tanks.water, v.water ?? 0);
      if (v.mercury) drain(d.tanks.mercury, v.mercury);
      takeFromSlot(d.slots, 0, 1);
      let n = v.count ?? 1;
      if (v.bonus_chance && Math.random() < v.bonus_chance) n += v.bonus ?? 1;
      // weathered copper -> its unweathered form: the result names the block itself
      putOut(d, [1, 2], { id: bedrockId(v.result), n });
    }
    return "running";
  },
});

// ---- Water Pump: 1,000 mB per 20 t from the water source below, 10 FE/t; pushes into pipes
defineMachine("water_pump", {
  energy: { cap: 10000, in: true },
  tanks: { water: { cap: 4000, gives: true } },
  work({ block, d }) {
    if (d.tanks.water.n > 0) d.tanks.water.n -= pushFluid(block, "water", Math.min(d.tanks.water.n, 100 * TICK));
    if (d.tanks.water.n <= 0) d.tanks.water.f = null;
    const below = blockAt(block.dimension, add(block.location, DIRS.down));
    if (!below || below.typeId !== "minecraft:water") return "idle";
    if (d.tanks.water.n > 3000) return "full";
    if (!useEnergy(d, E(10) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= T(20)) {
      d.progress = 0;
      fill(d.tanks.water, 4000, "water", 1000);
      // a lone source is used up, as vanilla's infinite-water rule has it
      let sources = 0;
      for (const dir of ["north", "south", "east", "west"]) {
        const nb = blockAt(block.dimension, add(below.location, DIRS[dir]));
        if (nb?.typeId === "minecraft:water" && nb.permutation.getState("liquid_depth") === 0) sources++;
      }
      if (sources < 2) below.setType("minecraft:air");
    }
    return "running";
  },
});

// ---- Sifter: no power. Holding a siftable block sifts it at once; hoppers feed it, a block per 20 t (40 with a mesh)
const SIFTABLE = new Set(["minecraft:gravel", "minecraft:sand", "minecraft:red_sand", "minecraft:soul_sand", "nookworks:crude_salt",
  "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:rooted_dirt", "minecraft:mud",
  "nookworks:deepslate_gravel", "nookworks:nether_grit", "nookworks:end_gravel"]);
function siftTable(id, mesh) {
  const [ns, p] = id.split(":");
  const path = p === "dirt_with_roots" ? "rooted_dirt" : p;
  return (mesh && DATA.loot[`sifting_fine/${ns}/${path}`]) ? `sifting_fine/${ns}/${path}` : `sifting/${ns}/${path}`;
}
export function sift(id, mesh) {
  return roll(siftTable(id, mesh));
}
defineMachine("sifter", {
  slots: 11, inputs: [0, 10], outputs: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  accepts: (d, p, i) => (i === 0 ? SIFTABLE.has(p.id) : p.id === "nookworks:brass_mesh"),
  progressMax: ({ d }) => setting("sifterTicks") * (d.slots[10] ? 2 : 1),
  interact({ block, player, d }) {
    const h = player.getComponent("minecraft:equippable").getEquipment("Mainhand");
    if (!h || !SIFTABLE.has(h.typeId) || player.isSneaking) return false;
    for (const o of sift(h.typeId, !!d.slots[10])) {
      const s = new ItemStack(o.id, Math.max(1, Math.min(64, o.n)));
      block.dimension.spawnItem(s, { x: block.location.x + 0.5, y: block.location.y + 1.1, z: block.location.z + 0.5 });
    }
    if (!isCreative(player)) {
      if (h.amount > 1) {
        h.amount--;
        player.getComponent("minecraft:equippable").setEquipment("Mainhand", h);
      } else player.getComponent("minecraft:equippable").setEquipment("Mainhand", undefined);
    }
    block.dimension.playSound("dig.gravel", block.location);
    return true;
  },
  work({ d }) {
    const s = d.slots[0];
    if (!s) {
      d.progress = 0;
      return "idle";
    }
    if (d.slots.slice(1, 10).every((x) => x)) return "blocked";
    d.progress += TICK;
    if (d.progress >= setting("sifterTicks") * (d.slots[10] ? 2 : 1)) {
      d.progress = 0;
      takeFromSlot(d.slots, 0, 1);
      for (const o of sift(s.id, !!d.slots[10])) putOut(d, [1, 2, 3, 4, 5, 6, 7, 8, 9], { id: o.id, n: o.n });
    }
    return "running";
  },
});
