// Tanks, pipes, valves and experience (docs/java_spec.md §3-5). Pipes carry no stock of their own here: a holder
import { redstoneIn } from "../lib/blocks.js";
// that gives pushes through the pipe network into holders that take.
import { world, system, ItemStack } from "@minecraft/server";
import { defineMachine } from "../lib/machine.js";
import { onBlock, TICK, bump } from "../lib/blocks.js";
import { DIRS, add, blockAt, held, state, setStates, safe } from "../lib/util.js";
import { pushFluid, drain, fill } from "../lib/fluids.js";
import * as store from "../lib/store.js";

const CONTENT = { water: "water", vegetable_oil: "oil", biodiesel: "biodiesel" };
const level7 = (n, cap) => (n <= 0 ? 0 : Math.max(1, Math.min(6, Math.round((6 * n) / cap))));

// ---- Copper Tank: 16,000 mB, any one liquid but mercury; pours 1,000 mB/t into what is below; gives to pipes
defineMachine("copper_tank", {
  keepsContents: true,
  tanks: { main: { cap: 16000, accepts: (f) => f !== "mercury" && f !== "experience", gives: true } },
  work({ block, d }) {
    const t = d.tanks.main;
    if (t.n > 0 && t.f) drain(t, pushFluid(block, t.f, Math.min(t.n, 100 * TICK), { consumersOnly: true }));
    if (t.n > 0) {
      const below = blockAt(block.dimension, add(block.location, DIRS.down));
      if (below?.typeId === "nookworks:copper_tank") {
        const bd = store.get(below, () => ({ tanks: { main: { f: null, n: 0 } } }));
        bd.tanks ??= { main: { f: null, n: 0 } };
        const moved = fill(bd.tanks.main, 16000, t.f, Math.min(t.n, 1000 * TICK));
        drain(t, moved);
        store.save(below);
      }
    }
    setStates(block, { content: t.f ? CONTENT[t.f] ?? "other" : "empty", level: level7(t.n, 16000) });
    return "idle";
  },
});

// ---- Mercury Tank: 16,000 mB of mercury
defineMachine("mercury_tank", {
  keepsContents: true,
  tanks: { main: { cap: 16000, accepts: (f) => f === "mercury", gives: true } },
  work({ block, d }) {
    const t = d.tanks.main;
    if (t.n > 0) drain(t, pushFluid(block, "mercury", Math.min(t.n, 100 * TICK), { consumersOnly: true }));
    setStates(block, { level: level7(t.n, 16000) });
    return "idle";
  },
});

// ---- Valve: an empty hand opens/shuts it; a redstone signal coming on opens, going off shuts
onBlock("valve", {
  placedBy: ({ block }) => setStates(block, { open: true }),
  interact: ({ block, player }) => {
    if (held(player)) return;
    setStates(block, { open: !state(block, "open") });
    bump();
    block.dimension.playSound("random.lever_click", block.location);
  },
  tick: ({ block }) => {
    const p = redstoneIn(block) > 0;
    const d = store.get(block, () => ({ p }));
    if (p !== d.p) {
      d.p = p;
      setStates(block, { open: p });
      bump();
      store.save(block);
    }
  },
});

// ---- Experience Tank: 16,000 mB (20 mB a point); its tap (empty hand) pours 5 points a tick as orbs
defineMachine("experience_tank", {
  keepsContents: true,
  tanks: { main: { cap: 16000, accepts: (f) => f === "experience", gives: true } },
  interact({ block, player, d }) {
    if (held(player)) return false;
    setStates(block, { open: !state(block, "open") });
    return true;
  },
  work({ block, d }) {
    const t = d.tanks.main;
    if (!state(block, "open") && t.n > 0) drain(t, pushFluid(block, "experience", Math.min(t.n, 100 * TICK), { consumersOnly: true }));
    if (state(block, "open") && t.n >= 20) {
      const pts = Math.min(5 * TICK, Math.floor(t.n / 20));
      drain(t, pts * 20);
      orbs(block.dimension, block.center(), pts);
    }
    setStates(block, { level: level7(t.n, 16000) });
    return "idle";
  },
});

export function orbs(dim, pos, points) {
  // an orb entity per few points (Bedrock xp_orb gives 1-? each); summon the vanilla way
  let n = Math.min(points, 800);
  while (n > 0) {
    try {
      dim.spawnEntity("minecraft:xp_orb", pos);
    } catch {
      break;
    }
    n -= 1;
  }
}

// ---- Absorption Pad: draws in orbs within 6 and the experience of a player standing on it, into its 2,000 mB
defineMachine("absorption_pad", {
  tanks: { main: { cap: 2000, accepts: (f) => f === "experience", gives: true } },
  work({ block, d }) {
    const t = d.tanks.main;
    if (redstoneIn(block) > 0) return "redstone";
    const c = block.center();
    for (const orb of block.dimension.getEntities({ type: "minecraft:xp_orb", location: c, maxDistance: 6 })) {
      if (t.n + 20 > 2000) break;
      orb.remove();
      fill(t, 2000, "experience", 20);
    }
    for (const p of block.dimension.getPlayers({ location: { x: c.x, y: block.location.y + 0.5, z: c.z }, maxDistance: 1 })) {
      if (p.level <= 0 && p.xpEarnedAtCurrentLevel <= 0) continue;
      const take = Math.max(1, Math.ceil(p.totalXpNeededForNextLevel / 5));
      const room = Math.floor((2000 - t.n) / 20);
      const k = Math.min(take, room, p.getTotalXp());
      if (k <= 0) continue;
      p.addExperience(-k);
      fill(t, 2000, "experience", k * 20);
    }
    if (t.n > 0) {
      const moved = pushFluid(block, "experience", Math.min(t.n, 500 * TICK));
      drain(t, moved);
    }
    setStates(block, { powered: t.n > 0 });
    return t.n > 0 ? "running" : "idle";
  },
});

// ---- Liquid Experience Bottle on an enchanting table: a Bottle o' Enchanting (Bedrock: used on the table)
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.block.typeId !== "minecraft:enchanting_table" || e.itemStack?.typeId !== "nookworks:liquid_experience_bottle") return;
  e.cancel = true;
  const p = e.player;
  system.run(() => {
    const inv = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < inv.size; i++) {
      const s = inv.getItem(i);
      if (s?.typeId === "minecraft:lapis_lazuli") {
        if (s.amount > 1) {
          s.amount--;
          inv.setItem(i, s);
        } else inv.setItem(i, undefined);
        const h = p.getComponent("minecraft:equippable").getEquipment("Mainhand");
        if (h.amount > 1) {
          h.amount--;
          p.getComponent("minecraft:equippable").setEquipment("Mainhand", h);
          inv.addItem(new ItemStack("minecraft:experience_bottle", 1));
        } else p.getComponent("minecraft:equippable").setEquipment("Mainhand", new ItemStack("minecraft:experience_bottle", 1));
        return;
      }
    }
  });
});
