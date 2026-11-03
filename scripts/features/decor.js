// Lights and small decor (docs/java_spec.md §14, §11 warp anchor / dark matter).
import { redstoneIn } from "../lib/blocks.js";
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { onBlock } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { DIRS, add, blockAt, held, consumeHeld, state, setStates, isCreative, give, tr, actionbar, safe } from "../lib/util.js";
import { DATA } from "../generated/data.js";
import { onAnyPlace } from "../lib/blocks.js";
import { setting } from "./settings.js";

const IGNITERS = new Set(["minecraft:flint_and_steel", "minecraft:fire_charge"]);
function ignite(player, block) {
  const h = held(player);
  if (!h || !IGNITERS.has(h.typeId)) return false;
  if (h.typeId === "minecraft:fire_charge") consumeHeld(player);
  else if (!isCreative(player)) {
    const dur = h.getComponent("minecraft:durability");
    if (dur) {
      dur.damage = Math.min(dur.maxDurability, dur.damage + 1);
      player.getComponent("minecraft:equippable").setEquipment("Mainhand", h);
    }
  }
  block.dimension.playSound("fire.ignite", block.location);
  return true;
}

// ---- lanterns: sneak + empty hand puts a lit one out (it becomes our unlit block); an igniter lights it again
const LANTERNS = ["lantern", "soul_lantern", "copper_lantern", "exposed_copper_lantern", "weathered_copper_lantern",
  "oxidized_copper_lantern", "waxed_copper_lantern", "waxed_exposed_copper_lantern", "waxed_weathered_copper_lantern",
  "waxed_oxidized_copper_lantern"];
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const t = e.block.typeId;
  if (!e.isFirstEvent || !e.player.isSneaking || e.itemStack) return;
  const name = t.replace("minecraft:", "");
  if (!t.startsWith("minecraft:") || !LANTERNS.includes(name)) return;
  e.cancel = true;
  const block = e.block;
  system.run(() => {
    const hanging = block.permutation.getState("hanging");
    block.setType(`nookworks:unlit_${name}`);
    setStates(block, { hanging: !!hanging });
    block.dimension.playSound("random.fizz", block.location, { volume: 0.4 });
  });
});
onBlock(LANTERNS.map((l) => `unlit_${l}`), {
  interact: ({ block, player }) => {
    if (!ignite(player, block)) return;
    const hanging = state(block, "hanging");
    block.setType("minecraft:" + block.typeId.slice(10).replace("unlit_", ""));
    try {
      block.setPermutation(block.permutation.withState("hanging", !!hanging));
    } catch {}
  },
});

// ---- sconce / wall sconce (placed unlit, lit like a candle, an empty hand snuffs it)
onBlock(["sconce", "wall_sconce"], {
  interact: ({ block, player }) => {
    if (state(block, "lit")) {
      if (!held(player)) {
        setStates(block, { lit: false });
        block.dimension.playSound("random.fizz", block.location, { volume: 0.3 });
      }
    } else if (ignite(player, block)) setStates(block, { lit: true });
  },
});

// ---- oil lamp: up to 4 bottles of vegetable oil, one burns 6,000 t
onBlock("oil_lamp", {
  interact: ({ block, player }) => {
    const h = held(player);
    const oil = state(block, "oil");
    if (h?.typeId === "nookworks:vegetable_oil_bottle" && oil < 4) {
      setStates(block, { oil: oil + 1 });
      consumeHeld(player);
      give(player, new ItemStack("minecraft:glass_bottle", 1));
    } else if (!h && state(block, "lit")) setStates(block, { lit: false });
    else if (oil > 0 && ignite(player, block)) setStates(block, { lit: true });
  },
  tick: ({ block }) => {
    if (!state(block, "lit")) return;
    const d = store.get(block, () => ({ burnt: 0 }));
    d.burnt += 10;
    if (d.burnt >= 6000) {
      d.burnt = 0;
      const oil = state(block, "oil") - 1;
      setStates(block, { oil: Math.max(0, oil), lit: oil > 0 });
    }
    store.save(block);
  },
});

// ---- filament bulb: an empty hand switches it; a redstone signal coming on/going off switches it too
onBlock("filament_bulb", {
  interact: ({ block, player }) => {
    if (held(player)) return;
    setStates(block, { lit: !state(block, "lit") });
    block.dimension.playSound("random.click", block.location, { volume: 0.3, pitch: 1.6 });
  },
  tick: ({ block }) => {
    const p = redstoneIn(block) > 0;
    const d = store.get(block, () => ({ p: false }));
    if (p !== d.p) {
      d.p = p;
      setStates(block, { lit: p });
      store.save(block);
    }
  },
});

// ---- campfires are set down unlit
onAnyPlace(({ block }) => {
  if (!setting("campfiresUnlit")) return;
  if (block.typeId === "minecraft:campfire" || block.typeId === "minecraft:soul_campfire") {
    try {
      block.setPermutation(block.permutation.withState("extinguished", true));
    } catch {}
  }
});

// ---- placed bottles: sneak + a bottle on a block top sets it down; up to 4; an empty hand takes one back
const BOTTLES = new Set(Object.keys(DATA.dataMaps["item/placed_bottle"]?.values ?? {}).filter((k) => !k.startsWith("#")).map((k) => k));
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || !e.player.isSneaking || !e.itemStack || e.blockFace !== "Up") return;
  const id = e.itemStack.typeId;
  if (!BOTTLES.has(id) && id !== "minecraft:glass_bottle") return;
  if (/potion/.test(id)) return;
  const target = e.block.typeId === "nookworks:placed_bottles" ? e.block : blockAt(e.block.dimension, add(e.block.location, DIRS.up));
  if (!target || !(target.isAir || target.typeId === "nookworks:placed_bottles")) return;
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    if (target.isAir) target.setType("nookworks:placed_bottles");
    const d = store.get(target, () => ({ bottles: [] }));
    if (d.bottles.length >= 4) return;
    d.bottles.push(id);
    setStates(target, { bottles: Math.max(2, d.bottles.length) });
    d.bottles.forEach((b, i) => setStates(target, { [`filled_${i}`]: b !== "minecraft:glass_bottle" }));
    store.save(target);
    consumeHeld(player);
    target.dimension.playSound("block.glass.place", target.location);
  });
});
onBlock("placed_bottles", {
  interact: ({ block, player }) => {
    if (held(player)) return;
    const d = store.get(block, () => ({ bottles: ["minecraft:glass_bottle"] }));
    const b = d.bottles.pop();
    if (b) give(player, new ItemStack(b, 1));
    if (!d.bottles.length) {
      store.remove(block);
      block.setType("minecraft:air");
      return;
    }
    setStates(block, { bottles: Math.max(2, d.bottles.length) });
    store.save(block);
  },
  broken: ({ block, dim }) => {
    const d = store.getKey(store.keyOf(block));
    for (const b of d?.bottles ?? []) dim.spawnItem(new ItemStack(b, 1), block.center());
  },
});

// ---- tableware and pebbles stack like candles
for (const [name, max] of [["wine_glass", 4], ["mug", 4], ["pebbles", 4]]) {
  const key = name === "pebbles" ? "pebbles" : "count";
  onBlock(name, {
    broken: ({ block, dim, perm, player }) => {
      if (player && isCreative(player)) return;
      const n = perm.getState(`nookworks:${key}`) ?? 1;
      dim.spawnItem(new ItemStack(`nookworks:${name}`, n), block.center());
    },
    interact: ({ block, player }) => {
      const h = held(player);
      if (h?.typeId !== block.typeId) return;
      const n = state(block, key);
      if (n < max) {
        setStates(block, { [key]: n + 1 });
        consumeHeld(player);
      }
    },
  });
}

// ---- Warp Anchor: a click toggles it; while on, endermen and shulkers seen within ±4/±2 are put back when they
//      jump (Bedrock has no teleport event to cancel), and pearls entering it are stopped
export const anchors = new Map(); // key -> {dim, pos}
onBlock("warp_anchor", {
  interact: ({ block }) => {
    setStates(block, { on: !state(block, "on") });
    block.dimension.playSound(state(block, "on") ? "beacon.activate" : "beacon.deactivate", block.location);
  },
  broken: ({ block }) => anchors.delete(`${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`),
  tick: ({ block }) => {
    const key = `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
    if (!state(block, "on")) return void anchors.delete(key);
    anchors.set(key, { dim: block.dimension.id, pos: block.center() });
    const c = block.center();
    const d = store.get(block, () => ({ seen: {} }));
    d.seen ??= {};
    for (const e of block.dimension.getEntities({ location: c, maxDistance: 7 })) {
      const l = e.location;
      if (Math.abs(l.x - c.x) > 4.5 || Math.abs(l.z - c.z) > 4.5 || Math.abs(l.y - c.y) > 2.5) continue;
      if (e.typeId === "minecraft:enderman" || e.typeId === "minecraft:shulker") {
        const last = d.seen[e.id];
        if (!last || (Math.abs(last.x - l.x) < 2 && Math.abs(last.z - l.z) < 2)) d.seen[e.id] = { x: l.x, y: l.y, z: l.z };
      }
      if (e.typeId === "minecraft:ender_pearl") e.remove();
    }
    // those seen: wherever they jumped to, back they come
    for (const [id, last] of Object.entries(d.seen)) {
      const e = world.getEntity(id);
      if (!e?.isValid) {
        delete d.seen[id];
        continue;
      }
      const l = e.location;
      if (Math.abs(l.x - last.x) > 2 || Math.abs(l.z - last.z) > 2 || Math.abs(l.y - last.y) > 3) e.teleport(last, { dimension: block.dimension });
    }
    store.save(block);
  },
});
/** Is a place within an anchor's box? (Lode Pearls ask) */
export function anchored(dimId, p) {
  for (const a of anchors.values())
    if (a.dim === dimId && Math.abs(p.x - a.pos.x) <= 4.5 && Math.abs(p.z - a.pos.z) <= 4.5 && Math.abs(p.y - a.pos.y) <= 2.5) return true;
  return false;
}

// ---- Dark Matter: night at noon nearby. Bedrock can't take light away, so players within 7 are given Darkness.
onBlock("dark_matter", {
  tick: ({ block }) => {
    for (const p of block.dimension.getPlayers({ location: block.center(), maxDistance: 7 })) {
      try {
        p.addEffect("darkness", 40, { amplifier: 0, showParticles: false });
      } catch {}
    }
  },
});

// ---- set against a wall: the wall form (Java's StandingAndWallBlockItem), facing out from the wall
const WALL_FORM = { "nookworks:sconce": "nookworks:wall_sconce", "nookworks:dawnwood_sign": "nookworks:dawnwood_wall_sign",
  "nookworks:dawnwood_hanging_sign": "nookworks:dawnwood_wall_hanging_sign" };
const FACES = { North: "north", South: "south", East: "east", West: "west" };
const lastFace = new Map();
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (e.itemStack && WALL_FORM[e.itemStack.typeId]) lastFace.set(e.player.id, { face: e.blockFace, t: system.currentTick });
});
world.afterEvents.playerPlaceBlock.subscribe(
  safe((e) => {
    const wall = WALL_FORM[e.block.typeId];
    const f = lastFace.get(e.player.id);
    if (!wall || !f || system.currentTick - f.t > 2 || !FACES[f.face]) return;
    const keep = e.block.typeId === "nookworks:sconce" ? { "nookworks:lit": e.block.permutation.getState("nookworks:lit") ?? false } : {};
    e.block.setPermutation(BlockPermutation.resolve(wall, { "minecraft:cardinal_direction": FACES[f.face], ...keep }));
  }, "wall form")
);
