// Small helpers shared by every feature.
import { world, system, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";

export const NS = "nookworks";
export const id = (name) => (name.includes(":") ? name : `${NS}:${name}`);
export const short = (typeId) => (typeId.startsWith(NS + ":") ? typeId.slice(NS.length + 1) : typeId);

export const DIRS = {
  north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 }, east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, down: { x: 0, y: -1, z: 0 },
};
export const OPPOSITE = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
export const HORIZONTAL = ["north", "east", "south", "west"];
export const add = (p, d, n = 1) => ({ x: p.x + d.x * n, y: p.y + d.y * n, z: p.z + d.z * n });
export const posKey = (dim, p) => `${dim.id ?? dim}|${p.x},${p.y},${p.z}`;
export const parseKey = (k) => {
  const [dim, xyz] = k.split("|");
  const [x, y, z] = xyz.split(",").map(Number);
  return { dim, pos: { x, y, z } };
};
export const center = (p) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });

/** The block at a position, or undefined when its chunk is not loaded. */
export function blockAt(dim, p) {
  try {
    return dim.getBlock(p);
  } catch {
    return undefined;
  }
}

export function neighbour(block, dir) {
  return blockAt(block.dimension, add(block.location, DIRS[dir]));
}

export function state(block, name) {
  try {
    return block.permutation.getState(name.includes(":") ? name : `${NS}:${name}`);
  } catch {
    return undefined;
  }
}

/** Sets custom states, silently skipping any the block doesn't have. */
export function setStates(block, states) {
  let perm = block.permutation;
  let changed = false;
  for (const [k, v] of Object.entries(states)) {
    const name = k.includes(":") ? k : `${NS}:${k}`;
    try {
      if (perm.getState(name) !== v) {
        perm = perm.withState(name, v);
        changed = true;
      }
    } catch {}
  }
  if (changed) block.setPermutation(perm);
  return changed;
}

/** Java 'facing' of a block (cardinal or 6-way trait, or our own state). */
export function facing(block) {
  return (
    state(block, "minecraft:cardinal_direction") ??
    state(block, "minecraft:facing_direction") ??
    state(block, "facing") ??
    "north"
  );
}

export function held(player) {
  return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
}

export function setHeld(player, stack) {
  player.getComponent("minecraft:equippable")?.setEquipment(EquipmentSlot.Mainhand, stack);
}

export function isCreative(player) {
  try {
    return player.getGameMode() === GameMode.Creative;
  } catch {
    return false;
  }
}

/** Uses up one of the held item (not in creative). */
export function consumeHeld(player, n = 1) {
  if (isCreative(player)) return;
  const s = held(player);
  if (!s) return;
  if (s.amount > n) {
    s.amount -= n;
    setHeld(player, s);
  } else setHeld(player, undefined);
}

/** Puts a stack in the player's inventory, dropping what does not fit. */
export function give(player, stack) {
  if (!stack || stack.amount <= 0) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  const rest = inv ? inv.addItem(stack) : stack;
  if (rest) player.dimension.spawnItem(rest, player.location);
}

export function drop(dim, pos, stack) {
  if (!stack || stack.amount <= 0) return;
  try {
    dim.spawnItem(stack, center(pos));
  } catch {}
}

export function makeStack(typeId, amount = 1) {
  try {
    const max = new ItemStack(typeId, 1).maxAmount;
    return new ItemStack(typeId, Math.max(1, Math.min(amount, max)));
  } catch {
    return undefined;
  }
}

/** Drops `amount` of an item as full stacks. */
export function dropMany(dim, pos, typeId, amount) {
  while (amount > 0) {
    const s = makeStack(typeId, amount);
    if (!s) return;
    drop(dim, pos, s);
    amount -= s.amount;
  }
}

export function tr(key, ...withArgs) {
  return withArgs.length
    ? { translate: key, with: { rawtext: withArgs.map((w) => (typeof w === "object" ? w : { text: String(w) })) } }
    : { translate: key };
}

export function actionbar(player, msg) {
  try {
    player.onScreenDisplay.setActionBar(typeof msg === "string" ? { rawtext: [{ text: msg }] } : { rawtext: [msg] });
  } catch {}
}

export function itemName(typeId) {
  // the localization key Bedrock uses for an item's name
  if (typeId.startsWith(NS + ":")) {
    const s = short(typeId);
    return { translate: `item.nookworks.${s}`, fallback: `block.nookworks.${s}` };
  }
  return { translate: `item.${typeId.replace("minecraft:", "")}.name` };
}

const PASSABLE = /air|water|lava|flower|tulip|orchid|allium|bluet|daisy|poppy|dandelion|cornflower|lily_of|rose|grass$|short_grass|tall_grass|fern|bush|sapling|torch|rail|button|lever|sign|banner|carpet|snow_layer|vine|kelp|seagrass|mushroom$|fungus|roots|wheat|carrots|potatoes|beetroot|redstone_wire|tripwire|pressure_plate|light_block|fire|ladder|cobweb|web$|sugar_cane|reeds|coral_fan|pointed_dripstone|candle|frame|rope|thin_rope|hung_light|crop|corn$|onions|rice|propagule|sprout/;
/** A block one can't walk through (Block.isSolid is not in the stable API). */
export function isSolidBlock(b) {
  if (!b || b.isAir || b.isLiquid) return false;
  return !PASSABLE.test(b.typeId);
}

export function chance(p) {
  return Math.random() < p;
}

export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function log(...a) {
  console.warn("[nookworks]", ...a);
}

/** Runs fn and logs (instead of throwing up the tick loop) on error. */
export function safe(fn, label = "") {
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      console.error(`[nookworks] ${label}: ${e}\n${e?.stack ?? ""}`);
    }
  };
}

export const later = (ticks, fn) => system.runTimeout(safe(fn, "later"), ticks);
export { world, system };
