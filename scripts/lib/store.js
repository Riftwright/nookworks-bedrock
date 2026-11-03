// Per-block data (what Java keeps in block entities), saved as world dynamic properties.
// One property per block, "b|<dim>|x,y,z" -> JSON. Cached in memory and written back a little after each change.
import { world, system, ItemStack } from "@minecraft/server";
import { posKey } from "./util.js";

const cache = new Map();
const dirty = new Set();
const PREFIX = "b|";

export function keyOf(block) {
  return posKey(block.dimension, block.location);
}

/** The data of this block; data left at the place by another block (replaced without our break event) is dropped. */
export function get(block, init) {
  const k = keyOf(block);
  let d = getKey(k);
  if (d && d._t && d._t !== block.typeId) {
    removeKey(k);
    d = undefined;
  }
  if (!d && init) {
    d = getKey(k, init);
    d._t = block.typeId;
  }
  return d;
}

export function getKey(k, init) {
  let d = cache.get(k);
  if (d === undefined) {
    const raw = world.getDynamicProperty(PREFIX + k);
    d = raw ? JSON.parse(raw) : null;
    cache.set(k, d);
  }
  if (d === null && init) {
    d = typeof init === "function" ? init() : structuredCloneSafe(init);
    cache.set(k, d);
    dirty.add(k);
  }
  return d ?? undefined;
}

export function has(block) {
  return !!getKey(keyOf(block));
}

export function save(block) {
  dirty.add(keyOf(block));
}

export function saveKey(k) {
  dirty.add(k);
}

export function set(block, d) {
  const k = keyOf(block);
  d._t = block.typeId;
  cache.set(k, d);
  dirty.add(k);
}

export function remove(block) {
  removeKey(keyOf(block));
}

export function removeKey(k) {
  cache.set(k, null);
  dirty.delete(k);
  world.setDynamicProperty(PREFIX + k, undefined);
}

/** Every stored block key (used by networks and global lookups). */
export function allKeys() {
  const out = new Set();
  for (const id of world.getDynamicPropertyIds()) if (id.startsWith(PREFIX)) out.add(id.slice(PREFIX.length));
  for (const [k, v] of cache) if (v) out.add(k);
  return [...out];
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}

export function flush() {
  for (const k of dirty) {
    const d = cache.get(k);
    world.setDynamicProperty(PREFIX + k, d ? JSON.stringify(d) : undefined);
  }
  dirty.clear();
}

system.runInterval(() => {
  try {
    flush();
  } catch (e) {
    console.error("[nookworks] store flush " + e);
  }
}, 40);

// ---- item stacks <-> plain objects

export function packItem(stack) {
  if (!stack) return null;
  const o = { id: stack.typeId, n: stack.amount };
  try {
    if (stack.nameTag) o.name = stack.nameTag;
    const lore = stack.getLore();
    if (lore.length) o.lore = lore;
    const dur = stack.getComponent("minecraft:durability");
    if (dur && dur.damage) o.dmg = dur.damage;
    const en = stack.getComponent("minecraft:enchantable");
    if (en) {
      const list = en.getEnchantments().map((e) => [e.type.id, e.level]);
      if (list.length) o.ench = list;
    }
    const props = stack.getDynamicPropertyIds?.() ?? [];
    if (props.length) {
      o.dp = {};
      for (const p of props) o.dp[p] = stack.getDynamicProperty(p);
    }
  } catch {}
  return o;
}

export function unpackItem(o) {
  if (!o || !o.id || o.n <= 0) return undefined;
  let s;
  try {
    s = new ItemStack(o.id, Math.min(o.n, 255));
  } catch {
    return undefined;
  }
  try {
    if (o.n > s.maxAmount) s.amount = s.maxAmount;
    if (o.name) s.nameTag = o.name;
    if (o.lore) s.setLore(o.lore);
    if (o.dmg) {
      const dur = s.getComponent("minecraft:durability");
      if (dur) dur.damage = o.dmg;
    }
    if (o.ench) {
      const en = s.getComponent("minecraft:enchantable");
      for (const [type, level] of o.ench) {
        try {
          en?.addEnchantment({ type, level });
        } catch {}
      }
    }
    if (o.dp) for (const [k, v] of Object.entries(o.dp)) s.setDynamicProperty(k, v);
  } catch {}
  return s;
}

/** Two packed items that would stack together. */
export function sameItem(a, b) {
  if (!a || !b) return false;
  return a.id === b.id && !a.dmg && !b.dmg && !a.ench && !b.ench && !a.dp && !b.dp && a.name === b.name;
}

export function maxStack(id) {
  try {
    return new ItemStack(id, 1).maxAmount;
  } catch {
    return 64;
  }
}
