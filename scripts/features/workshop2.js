// Repair Box, Laser, Planter, Spawn Egg Brewer, Spawner Controller and links, Trading Counter, Barter Terminal
// (docs/java_spec.md §2, §10). Where Bedrock's script API cannot reach (spawner contents, villager trades), the
// replacement is described in GAPS.md.
import { world, system, ItemStack } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { defineMachine, useEnergy, putOut, itemText, fits } from "../lib/machine.js";
import { onBlock, TICK } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { unpackItem } from "../lib/store.js";
import { DIRS, OPPOSITE, add, blockAt, held, setHeld, isCreative, tr, actionbar, safe, setStates, state, posKey, parseKey, facing } from "../lib/util.js";
import { deliverBelow, takeFromSlot, containerOf } from "../lib/inv.js";
import { containerOfBlock } from "../lib/invent.js";
import { drain } from "../lib/fluids.js";
import { roll } from "../lib/loot.js";
import { DATA } from "../generated/data.js";
import { setting } from "./settings.js";
import { isPlacedLog } from "./chain_breaking.js";

const E = (n) => Math.ceil(n * setting("machineEnergy"));
const dir6 = (b) => state(b, "minecraft:facing_direction") ?? state(b, "minecraft:cardinal_direction") ?? "north";

// ---- Repair Box: every 10 t, 5 durability back on the most worn item for 200 FE + 20 mB of liquid experience
defineMachine("repair_box", {
  slots: 6, inputs: [0, 1, 2, 3, 4, 5], energy: { cap: 20000, in: true },
  tanks: { xp: { cap: 4000, accepts: (f) => f === "experience" } },
  accepts: (d, p) => {
    try {
      return !!new ItemStack(p.id, 1).getComponent("minecraft:durability");
    } catch {
      return false;
    }
  },
  work({ block, d }) {
    let worst = -1, most = 0;
    d.slots.forEach((s, i) => {
      if (s?.dmg > most) (most = s.dmg), (worst = i);
    });
    // finished pieces go below
    d.slots.forEach((s, i) => {
      if (s && !s.dmg && deliverBelow(block, s, { noDrop: true }) === 0) d.slots[i] = null;
    });
    if (worst < 0) return "idle";
    if (d.tanks.xp.n < 20) return "no_fluid";
    if (!useEnergy(d, E(200))) return "no_power";
    drain(d.tanks.xp, 20);
    const c = containerOfBlock(block, false);
    const real = c?.getItem(worst);
    const dur = real?.getComponent("minecraft:durability");
    if (dur) {
      dur.damage = Math.max(0, dur.damage - 5);
      c.setItem(worst, real);
    }
    d.slots[worst].dmg = Math.max(0, d.slots[worst].dmg - 5);
    return "running";
  },
});

// ---- Laser: a beam up to 8 blocks ahead; fells natural trees (4,000 FE each), sets flammables alight, hurts
defineMachine("laser", {
  energy: { cap: 120000, in: true },
  work({ block, d }) {
    const f = dir6(block);
    let len = 0, target = null;
    for (let i = 1; i <= 8; i++) {
      const b = blockAt(block.dimension, add(block.location, DIRS[f], i));
      if (!b) break;
      if (b.isAir || b.isLiquid || /grass|flower|torch|rail|carpet|snow_layer|light_block/.test(b.typeId)) {
        len = i;
        continue;
      }
      target = b;
      break;
    }
    if (!target && !nearbyMobs(block, f, len).length) {
      setStates(block, { beam: 0 });
      useEnergy(d, E(2) * TICK);
      return "idle";
    }
    if (!useEnergy(d, E(400) * TICK)) {
      setStates(block, { beam: 0 });
      return "no_power";
    }
    setStates(block, { beam: Math.min(8, len) });
    for (const m of nearbyMobs(block, f, len)) m.applyDamage(4, { cause: "fire" });
    if (target && /(_log|_stem)$/.test(target.typeId) && !isPlacedLog(block.dimension.id, target.location)) {
      if (d.fe < E(4000)) return "running";
      d.fe -= E(4000);
      fell(block.dimension, target);
    } else if (target && /planks|_log|wool|leaves|hay|bookshelf|_wood$/.test(target.typeId) && Math.random() < 0.15) {
      const above = blockAt(block.dimension, add(target.location, DIRS.up));
      if (above?.isAir) above.setType("minecraft:fire");
    }
    return "running";
  },
});
function nearbyMobs(block, f, len) {
  if (!len) return [];
  const c = block.center(), v = DIRS[f];
  const mid = { x: c.x + (v.x * (len + 1)) / 2, y: c.y + (v.y * (len + 1)) / 2, z: c.z + (v.z * (len + 1)) / 2 };
  return block.dimension.getEntities({ location: mid, maxDistance: len / 2 + 0.6, excludeFamilies: ["inanimate"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })
    .filter((e) => e.getComponent("minecraft:health"));
}
function fell(dim, base) {
  const type = base.typeId;
  const seen = new Set();
  const queue = [base.location];
  let n = 0;
  while (queue.length && n < setting("timberMax")) {
    const p = queue.shift();
    const k = `${p.x},${p.y},${p.z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockAt(dim, p);
    if (b?.typeId !== type) continue;
    dim.runCommand(`setblock ${p.x} ${p.y} ${p.z} air destroy`);
    n++;
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) queue.push({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
  }
}

// ---- Planter: 9 slots of seeds and saplings; one spot every 10 t in the 3 x 5 field in front, 20 FE a plant
const PLANTS = { "minecraft:wheat_seeds": "minecraft:wheat", "minecraft:carrot": "minecraft:carrots", "minecraft:potato": "minecraft:potatoes",
  "minecraft:beetroot_seeds": "minecraft:beetroot", "minecraft:melon_seeds": "minecraft:melon_stem", "minecraft:pumpkin_seeds": "minecraft:pumpkin_stem",
  "minecraft:torchflower_seeds": "minecraft:torchflower_crop", "minecraft:pitcher_pod": "minecraft:pitcher_crop" };
function plantOf(id) {
  if (PLANTS[id]) return PLANTS[id];
  if (/_sapling$|^minecraft:(mangrove_propagule|azalea|flowering_azalea)$/.test(id)) return id;
  const s = id.startsWith("nookworks:") && DATA.items[id.slice(10)]?.places;
  return s ? `nookworks:${s}` : null;
}
defineMachine("planter", {
  slots: 9, inputs: [0, 1, 2, 3, 4, 5, 6, 7, 8], energy: { cap: 10000, in: true }, autoOut: false,
  accepts: (d, p) => !!plantOf(p.id),
  work({ block, d }) {
    const f = facing(block);
    const fwd = DIRS[f], side = DIRS[{ north: "east", south: "west", east: "south", west: "north" }[f]];
    d.spot = ((d.spot ?? 0) + 1) % 15;
    const i = d.spot;
    const p = { x: block.location.x + fwd.x * (1 + Math.floor(i / 3)) + side.x * ((i % 3) - 1), y: block.location.y, z: block.location.z + fwd.z * (1 + Math.floor(i / 3)) + side.z * ((i % 3) - 1) };
    const spot = blockAt(block.dimension, p), soil = blockAt(block.dimension, add(p, DIRS.down));
    if (!spot || !soil || !(spot.isAir || spot.typeId === "minecraft:water")) return "idle";
    const k = d.slots.findIndex((s) => {
      if (!s) return false;
      const pl = plantOf(s.id);
      if (pl === "nookworks:rice") return spot.typeId === "minecraft:water";
      if (spot.typeId === "minecraft:water") return false;
      if (/_sapling|propagule|azalea/.test(pl)) return /dirt|grass_block|podzol|moss|mud|farmland/.test(soil.typeId);
      return soil.typeId === "minecraft:farmland" || soil.typeId === "nookworks:nourished_soil";
    });
    if (k < 0) return "idle";
    if (!useEnergy(d, E(20))) return "no_power";
    try {
      spot.setType(plantOf(d.slots[k].id));
      takeFromSlot(d.slots, k, 1);
    } catch {}
    return "running";
  },
});

// ---- Spawn Egg Brewer: a filled Mob Bottle + an egg + blaze powder (10 brews each) -> that mob's spawn egg, 200 t
defineMachine("spawn_egg_brewer", {
  slots: 4, inputs: [0, 1, 2], outputs: [3], progressMax: () => 200,
  accepts: (d, p, i) => [p.id === "nookworks:mob_bottle" && !!p.dp?.mob, p.id === "minecraft:egg", p.id === "minecraft:blaze_powder"][i],
  work({ d }) {
    const bottle = d.slots[0];
    const egg = bottle?.dp?.mob && `${bottle.dp.mob}_spawn_egg`;
    if (!egg) return "idle";
    if (!fits(d, 3, [{ id: egg, n: 1 }])) return "blocked";
    if (!bottle || !d.slots[1] || (!(d.brews > 0) && !d.slots[2])) {
      d.progress = 0;
      return "idle";
    }
    try {
      new ItemStack(egg, 1);
    } catch {
      return "idle";
    }
    d.progress += TICK;
    if (d.progress < 200) return "running";
    d.progress = 0;
    if (!(d.brews > 0)) {
      takeFromSlot(d.slots, 2, 1);
      d.brews = 10;
    }
    d.brews--;
    takeFromSlot(d.slots, 1, 1);
    // the bottle is emptied, not used up
    d.slots[0] = { id: "nookworks:mob_bottle", n: 1 };
    putOut(d, 3, { id: egg, n: 1 });
    return "running";
  },
});

// ---- Spawner links and controller. Bedrock scripts can't read or change a vanilla spawner, so the controller is a
//      spawner of its own: it brings forth the mob of the Mob Bottle put in it beside each Spawner Link Sender paired
//      with the receiver under it, by its settings (interval, count, max nearby), paying the Java cost.
const pairing = new Map();
onBlock("spawner_link_sender", {
  interact: ({ block, player }) => {
    pairing.set(player.id, posKey(block.dimension, block.location));
    actionbar(player, tr("nookworks.bedrock.link_started"));
  },
});
onBlock("spawner_link_receiver", {
  interact: ({ block, player }) => {
    const s = pairing.get(player.id);
    if (!s) return;
    pairing.delete(player.id);
    const d = store.get(block, () => ({ senders: [] }));
    d.senders ??= [];
    if (!d.senders.includes(s)) d.senders.push(s);
    store.save(block);
    actionbar(player, tr("nookworks.bedrock.linked", d.senders.length));
  },
});
defineMachine("spawner_controller", {
  slots: 1, inputs: [0],
  accepts: (d, p) => p.id === "nookworks:mob_bottle" && !!p.dp?.mob,
  init: (d) => Object.assign(d, { on: true, interval: 200, count: 4, maxNearby: 6, t: 0 }),
  lines: ({ d }) => [{ text: `${d.on ? "ON" : "OFF"}  ${d.interval / 20}s  x${d.count}  max ${d.maxNearby}` }],
  buttons: [{ label: { rawtext: [tr("nookworks.bedrock.settings")] }, run: ({ block, player, d }) => system.run(() => spawnerSettings(block, player, d)) }],
  work({ block, d }) {
    const recv = blockAt(block.dimension, add(block.location, DIRS.down));
    if (recv?.typeId !== "nookworks:spawner_link_receiver" || !d.on || !d.slots[0]?.dp?.mob) return "idle";
    const rd = store.get(recv, () => ({ senders: [], fe: 0 }));
    d.t += TICK;
    if (d.t < d.interval) return "running";
    d.t = 0;
    const mob = d.slots[0].dp.mob;
    for (const sk of rd.senders ?? []) {
      const { dim, pos } = parseKey(sk);
      const sb = blockAt(world.getDimension(dim), pos);
      if (sb?.typeId !== "nookworks:spawner_link_sender") continue;
      const cost = E(Math.max(20, Math.round((20 * 50 * d.count) / d.interval))) * d.interval;
      if ((rd.fe ?? 0) < cost) continue;
      const near = sb.dimension.getEntities({ type: mob, location: sb.center(), maxDistance: 8 }).length;
      if (near >= d.maxNearby) continue;
      rd.fe -= cost;
      for (let i = 0; i < Math.min(d.count, d.maxNearby - near); i++) {
        const p = { x: pos.x + 0.5 + (Math.random() * 6 - 3), y: pos.y + 1, z: pos.z + 0.5 + (Math.random() * 6 - 3) };
        try {
          sb.dimension.spawnEntity(mob, p);
        } catch {}
      }
      setStates(sb, { lit: true });
    }
    store.save(recv);
    return "running";
  },
});
import { registerHolder } from "../lib/energy.js";
registerHolder("spawner_link_receiver", { cap: 400000, in: true });
async function spawnerSettings(block, player, d) {
  const f = new ModalFormData().title({ rawtext: [tr("block.nookworks.spawner_controller")] })
    .toggle("ON", { defaultValue: d.on })
    .slider("s", 1, 120, { valueStep: 1, defaultValue: Math.round(d.interval / 20) })
    .slider("x", 1, 16, { valueStep: 1, defaultValue: d.count })
    .slider("max", 1, 64, { valueStep: 1, defaultValue: d.maxNearby });
  const r = await f.show(player);
  if (r.canceled) return;
  const [on, s, c, m] = r.formValues;
  Object.assign(d, { on: !!on, interval: Number(s) * 20, count: Number(c), maxNearby: Number(m) });
  store.save(block);
}

// ---- Trading Counter: the villager in the cell behind it trades by itself, payment in by hopper, goods out below.
//      Bedrock scripts can't see a villager's own offers, so each profession has a fixed list of its usual
//      first-tier trades (Java's counter used the villager's real ones).
const TRADES = {
  1: [["minecraft:wheat", 20, "minecraft:emerald", 1], ["minecraft:potato", 26, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:bread", 6]],
  2: [["minecraft:string", 20, "minecraft:emerald", 1], ["minecraft:coal", 10, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:cooked_cod", 6]],
  3: [["minecraft:white_wool", 18, "minecraft:emerald", 1], ["minecraft:emerald", 2, "minecraft:shears", 1]],
  4: [["minecraft:stick", 32, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:arrow", 16]],
  5: [["minecraft:paper", 24, "minecraft:emerald", 1], ["minecraft:emerald", 9, "minecraft:bookshelf", 1]],
  6: [["minecraft:paper", 24, "minecraft:emerald", 1], ["minecraft:emerald", 7, "minecraft:empty_map", 1]],
  7: [["minecraft:rotten_flesh", 32, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:redstone", 2]],
  8: [["minecraft:coal", 15, "minecraft:emerald", 1], ["minecraft:emerald", 5, "minecraft:iron_helmet", 1]],
  9: [["minecraft:coal", 15, "minecraft:emerald", 1], ["minecraft:emerald", 3, "minecraft:iron_axe", 1]],
  10: [["minecraft:coal", 15, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:stone_axe", 1]],
  11: [["minecraft:chicken", 14, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:cooked_porkchop", 5]],
  12: [["minecraft:leather", 6, "minecraft:emerald", 1], ["minecraft:emerald", 3, "minecraft:leather_chestplate", 1]],
  13: [["minecraft:clay_ball", 10, "minecraft:emerald", 1], ["minecraft:emerald", 1, "minecraft:brick", 10]],
};
function counterVillager(block) {
  const behind = add(block.location, DIRS[OPPOSITE[facing(block)]]);
  return block.dimension.getEntities({ type: "minecraft:villager_v2", location: { x: behind.x + 0.5, y: behind.y, z: behind.z + 0.5 }, maxDistance: 0.8 })[0];
}
defineMachine("trading_counter", {
  slots: 18, inputs: [0, 1, 2, 3, 4, 5, 6, 7, 8], outputs: [9, 10, 11, 12, 13, 14, 15, 16, 17], hopperRate: 8,
  init: (d) => (d.ticked = []),
  lines: ({ block, d }) => {
    const v = counterVillager(block);
    return [v ? { text: `§a● ${v.nameTag || "Villager"}` } : tr("nookworks.bedrock.no_villager")];
  },
  buttons: [{ label: { rawtext: [tr("nookworks.bedrock.trades")] }, run: ({ block, player, d }) => system.run(() => tradeForm(block, player, d)) }],
  work({ block, d }) {
    d.t = (d.t ?? 0) + TICK;
    if (d.t < 20) return "idle";
    d.t = 0;
    const v = counterVillager(block);
    if (!v) return "idle";
    const prof = v.getComponent("minecraft:variant")?.value ?? 0;
    for (const i of d.ticked ?? []) {
      const tr_ = TRADES[prof]?.[i];
      if (!tr_) continue;
      const [want, wn, give, gn] = tr_;
      const have = d.slots.slice(0, 9).reduce((s, x) => s + (x?.id === want ? x.n : 0), 0);
      if (have < wn) continue;
      if (!fits(d, [9, 10, 11, 12, 13, 14, 15, 16, 17], [{ id: give, n: gn }])) continue;
      putOut(d, [9, 10, 11, 12, 13, 14, 15, 16, 17], { id: give, n: gn });
      let left = wn;
      for (let k = 0; k < 9 && left; k++) if (d.slots[k]?.id === want) left -= takeFromSlot(d.slots, k, left).n;
      return "running";
    }
    return "idle";
  },
});
async function tradeForm(block, player, d) {
  const v = counterVillager(block);
  const prof = v?.getComponent("minecraft:variant")?.value ?? 0;
  const list = TRADES[prof] ?? [];
  if (!list.length) return actionbar(player, tr("nookworks.bedrock.no_villager"));
  const f = new ModalFormData().title({ rawtext: [tr("block.nookworks.trading_counter")] });
  list.forEach(([w, wn, g, gn], i) => f.toggle({ rawtext: [itemText(w), { text: ` x${wn} → ` }, itemText(g), { text: ` x${gn}` }] }, { defaultValue: (d.ticked ?? []).includes(i) }));
  const r = await f.show(player);
  if (r.canceled) return;
  d.ticked = r.formValues.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  store.save(block);
}

// ---- Barter Terminal: grown piglins within 6 blocks take its gold, one each per 119 t, and their barter goes in
//      its outputs (Java's sealed room with Nether air is not needed: Bedrock can't stop piglins zombifying, so keep
//      them in the Nether or in a boat).
defineMachine("barter_terminal", {
  slots: 11, inputs: [0], outputs: [2, 3, 4, 5, 6, 7, 8, 9, 10], energy: { cap: 20000, in: true },
  accepts: (d, p) => p.id === "minecraft:gold_ingot",
  work({ block, d }) {
    const piglins = block.dimension.getEntities({ type: "minecraft:piglin", location: block.center(), maxDistance: 6 }).filter((p) => !p.getComponent("minecraft:is_baby"));
    if (!piglins.length || !d.slots[0]) return "idle";
    if (!useEnergy(d, E(20) * TICK)) return "no_power";
    d.t = (d.t ?? 0) + TICK * piglins.length;
    while (d.t >= 119 && d.slots[0]?.id === "minecraft:gold_ingot") {
      d.pending ??= roll("piglin_bartering");
      if (!fits(d, [2, 3, 4, 5, 6, 7, 8, 9, 10], d.pending)) return "blocked";
      d.t -= 119;
      takeFromSlot(d.slots, 0, 1);
      for (const o of d.pending) putOut(d, [2, 3, 4, 5, 6, 7, 8, 9, 10], o);
      d.pending = null;
    }
    return "running";
  },
});
