// The mercury chain (docs/java_spec.md §3): Sealed Retort, Stirring Tank, Vacuum Distiller.
import { defineMachine, useEnergy, putOut } from "../lib/machine.js";
import { TICK } from "../lib/blocks.js";
import { DATA } from "../generated/data.js";
import { dataMapLookup, matches, bedrockId } from "../lib/ids.js";
import { roll } from "../lib/loot.js";
import { fill, drain, pushFluid } from "../lib/fluids.js";
import { takeFromSlot } from "../lib/inv.js";
import { DIRS, add, blockAt } from "../lib/util.js";
import { setting } from "./settings.js";

const dm = (n) => DATA.dataMaps[`item/${n}`];
const E = (n) => Math.ceil(n * setting("machineEnergy"));
const T = (n) => Math.max(1, Math.round(n * setting("machineTime")));

// ---- Sealed Retort: charge + reagents -> mercury, byproducts, a little liquid experience; 30 FE/t, 100 t
defineMachine("retort", {
  slots: 5, inputs: [0, 1, 2], outputs: [3, 4], energy: { cap: 10000, in: true }, progressMax: () => T(100),
  tanks: {
    water: { cap: 4000, accepts: (f) => f === "water" },
    mercury: { cap: 4000, gives: true },
    xp: { cap: 1000, gives: true },
  },
  accepts: (d, p, i) => (i === 0 ? !!dataMapLookup(dm("retorting"), p.id) : Object.values(dm("retorting").values).some((v) => (v.reagents ?? []).some((r) => matches(r, p.id)))),
  work({ block, d }) {
    let s = d.slots[0];
    let v = s && dataMapLookup(dm("retorting"), s.id);
    const boilWater = !s && d.tanks.water.n >= 1000;
    if (boilWater) v = dataMapLookup(dm("retorting"), "minecraft:water_bucket");
    if (!v) {
      d.progress = 0;
      return "idle";
    }
    // reagents present
    const need = (v.reagents ?? []).map((r) => r);
    const used = [];
    for (const r of need) {
      const i = [1, 2].find((j) => d.slots[j] && !used.includes(j) && matches(r, d.slots[j].id));
      if (i === undefined) return "idle";
      used.push(i);
    }
    if (d.slots[3] && d.slots[4]) return "blocked";
    if (v.mercury && d.tanks.mercury.n + v.mercury > 4000) return "full";
    if (!useEnergy(d, E(30) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= T(100)) {
      d.progress = 0;
      if (boilWater) drain(d.tanks.water, 1000);
      else takeFromSlot(d.slots, 0, 1);
      for (const i of used) takeFromSlot(d.slots, i, 1);
      if (v.mercury) fill(d.tanks.mercury, 4000, "mercury", v.mercury);
      if (v.byproduct) putOut(d, [3, 4], { id: bedrockId(v.byproduct), n: v.count ?? 1 });
      if (v.remainder && !boilWater) putOut(d, [3, 4], { id: bedrockId(v.remainder), n: 1 });
      d.xpPart = (d.xpPart ?? 0) + (v.experience ?? 0);
      const pts = Math.floor(d.xpPart);
      d.xpPart -= pts;
      if (pts) fill(d.tanks.xp, 1000, "experience", pts * 20);
    }
    if (d.tanks.mercury.n) drain(d.tanks.mercury, pushFluid(block, "mercury", Math.min(d.tanks.mercury.n, 1000)));
    if (d.tanks.xp.n) drain(d.tanks.xp, pushFluid(block, "experience", Math.min(d.tanks.xp.n, 1000)));
    return "running";
  },
});

// ---- Stirring Tank: amalgamation (ore + mercury), biodiesel (methanol + caustic soda + oil), mud; 20 FE/t, 80 t
defineMachine("stirring_tank", {
  slots: 3, inputs: [0, 1], outputs: [2], energy: { cap: 10000, in: true }, progressMax: () => T(80),
  tanks: {
    oil: { cap: 4000, accepts: (f) => f === "vegetable_oil" },
    biodiesel: { cap: 1000, gives: true },
    water: { cap: 4000, accepts: (f) => f === "water" },
    mercury: { cap: 4000, accepts: (f) => f === "mercury" },
  },
  accepts: (d, p, i) =>
    i === 0 ? !!dataMapLookup(dm("amalgamation"), p.id) || p.id === "nookworks:methanol" || matches("#minecraft:convertable_to_mud", p.id)
      : p.id === "nookworks:caustic_soda",
  work({ block, d }) {
    const s = d.slots[0];
    if (d.tanks.biodiesel.n) drain(d.tanks.biodiesel, pushFluid(block, "biodiesel", d.tanks.biodiesel.n));
    if (!s) {
      d.progress = 0;
      return "idle";
    }
    const am = dataMapLookup(dm("amalgamation"), s.id);
    let job = null;
    if (am && d.tanks.mercury.n >= am.mercury) job = "amalgam";
    else if (s.id === "nookworks:methanol" && d.tanks.oil.n >= 250 && d.tanks.biodiesel.n + 250 <= 1000 && (d.catalyst > 0 || d.slots[1])) job = "biodiesel";
    else if (matches("#minecraft:convertable_to_mud", s.id) && d.tanks.water.n >= 250) job = "mud";
    if (!job) return "idle";
    if (d.slots[2] && job !== "biodiesel" && d.slots[2].n >= 64) return "blocked";
    if (!useEnergy(d, E(20) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress < T(80)) return "running";
    d.progress = 0;
    takeFromSlot(d.slots, 0, 1);
    if (job === "amalgam") {
      drain(d.tanks.mercury, am.mercury);
      putOut(d, 2, { id: bedrockId(am.result), n: am.count ?? 1 });
    } else if (job === "biodiesel") {
      if (!(d.catalyst > 0)) {
        takeFromSlot(d.slots, 1, 1);
        d.catalyst = 4;
      }
      d.catalyst--;
      drain(d.tanks.oil, 250);
      fill(d.tanks.biodiesel, 1000, "biodiesel", 250);
      putOut(d, 2, { id: "minecraft:glass_bottle", n: 1 });
    } else {
      drain(d.tanks.water, 250);
      putOut(d, 2, { id: "minecraft:mud", n: 1 });
    }
    return "running";
  },
});

// ---- Vacuum Distiller: runs only as a tower (2 Distillation Columns and a Condenser on top); 60 FE/t, 120 t
function towerOk(block) {
  const at = (i) => blockAt(block.dimension, add(block.location, DIRS.up, i))?.typeId;
  return at(1) === "nookworks:distillation_column" && at(2) === "nookworks:distillation_column" && at(3) === "nookworks:condenser";
}
defineMachine("distiller", {
  slots: 5, inputs: [0], outputs: [1, 2, 3, 4], energy: { cap: 20000, in: true }, progressMax: () => T(120),
  tanks: { mercury: { cap: 4000, gives: true } },
  accepts: (d, p) => !!dataMapLookup(dm("distillation"), p.id),
  work({ block, d }) {
    if (d.tanks.mercury.n) drain(d.tanks.mercury, pushFluid(block, "mercury", d.tanks.mercury.n));
    const s = d.slots[0];
    const v = s && dataMapLookup(dm("distillation"), s.id);
    if (!v) {
      d.progress = 0;
      return "idle";
    }
    if (!towerOk(block)) return "idle";
    if ([1, 2, 3, 4].every((i) => d.slots[i])) return "blocked";
    if (!useEnergy(d, E(60) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress < T(120)) return "running";
    d.progress = 0;
    takeFromSlot(d.slots, 0, 1);
    const outs = v.loot_table ? roll(v.loot_table) : [{ id: bedrockId(v.result), n: (v.count ?? 1) + (Math.random() < (v.bonus_chance ?? 0) ? v.bonus ?? 0 : 0) }];
    for (const o of outs) putOut(d, [1, 2, 3, 4], o);
    if (Math.random() < (v.velarium_chance ?? 0)) putOut(d, [1, 2, 3, 4], { id: "nookworks:velarium_nugget", n: 1 });
    if (v.mercury_returned) fill(d.tanks.mercury, 4000, "mercury", v.mercury_returned);
    return "running";
  },
});
