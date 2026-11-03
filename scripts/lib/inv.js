// Moving items between our blocks (slots kept as packed items in block data) and vanilla containers.
import { ItemStack } from "@minecraft/server";
import { DIRS, add, blockAt, center, isSolidBlock } from "./util.js";
import { packItem, unpackItem, sameItem, maxStack, packable } from "./store.js";

const HOPPER_FACING = { 0: "down", 2: "north", 3: "south", 4: "west", 5: "east" };

/** Vanilla container of a block (chest, barrel, hopper, ...), or undefined. */
export function containerOf(block) {
  try {
    return block?.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

/** Adds packed item `p` into slots[i]; returns how many did not fit. */
export function addToSlot(slots, i, p, limit) {
  const cap = limit ?? maxStack(p.id);
  const cur = slots[i];
  if (!cur) {
    const n = Math.min(cap, p.n);
    slots[i] = { ...p, n };
    return p.n - n;
  }
  if (!sameItem(cur, p)) return p.n;
  const n = Math.min(cap - cur.n, p.n);
  cur.n += n;
  return p.n - n;
}

/** Adds into any of the listed slots; returns the count left over. */
export function addToSlots(slots, idxs, p, limit) {
  let left = p.n;
  for (const i of idxs) {
    if (slots[i] && sameItem(slots[i], p)) left = addToSlot(slots, i, { ...p, n: left }, limit);
    if (!left) return 0;
  }
  for (const i of idxs) {
    if (!slots[i]) left = addToSlot(slots, i, { ...p, n: left }, limit);
    if (!left) return 0;
  }
  return left;
}

export function takeFromSlot(slots, i, n = 1) {
  const cur = slots[i];
  if (!cur) return null;
  const k = Math.min(n, cur.n);
  cur.n -= k;
  if (cur.n <= 0) slots[i] = null;
  return { ...cur, n: k };
}

/** Pushes a packed item into a vanilla container; returns the count left. */
export function pushInto(container, p) {
  let left = p.n;
  while (left > 0) {
    const s = unpackItem({ ...p, n: left });
    if (!s) return left;
    const was = s.amount;
    const rest = container.addItem(s);
    const placed = was - (rest?.amount ?? 0);
    left -= placed;
    if (placed === 0) break;
  }
  return left;
}

/** Where a machine puts what it made (Java's MachineIO.deliverBelow): into the container below, or the machine of
 * ours below; with no container there, dropped out where there is room - below, else on top, else beside. A full
 * container or machine below makes it wait. Returns the count left (still in the machine). */
export function deliverBelow(block, p, { noDrop = false, dir = "down", onlyDir = false } = {}) {
  const below = blockAt(block.dimension, add(block.location, DIRS[dir]));
  if (!below) return p.n;
  const c = containerOf(below);
  if (c) return pushInto(c, p);
  if (acceptors.has(below.typeId)) return acceptors.get(below.typeId)(below, { ...p }, dir);
  if (noDrop) return p.n;
  const order = onlyDir ? [dir] : [dir, "up", "north", "south", "east", "west", "down"];
  for (const d of order) {
    const at = blockAt(block.dimension, add(block.location, DIRS[d]));
    if (!at || !(at.isAir || at.isLiquid || !solidish(at))) continue;
    let left = p.n;
    while (left > 0) {
      const s = unpackItem({ ...p, n: left });
      if (!s) break;
      const q = at.location;
      block.dimension.spawnItem(s, { x: q.x + 0.5, y: q.y + (d === "down" ? 0.6 : 0.3), z: q.z + 0.5 });
      left -= s.amount;
    }
    return 0;
  }
  return p.n;
}

function solidish(b) {
  return isSolidBlock(b);
}

/** Our blocks that take items pushed into them: typeId -> (block, packed, fromDir) => leftover. */
export const acceptors = new Map();

/** Items offered by hoppers pointing into this block, one item per call per hopper. `accept(packed)` returns how
 * many it took. */
export function pullFromHoppers(block, accept, max = 1) {
  for (const [dir, d] of Object.entries(DIRS)) {
    const nb = blockAt(block.dimension, add(block.location, d));
    if (!nb || nb.typeId !== "minecraft:hopper") continue;
    const f = HOPPER_FACING[nb.permutation.getState("facing_direction")];
    const opp = { up: "down", down: "up", north: "south", south: "north", east: "west", west: "east" }[dir];
    if (f !== opp) continue;
    if (nb.permutation.getState("toggle_bit")) continue; // a powered hopper is locked
    const c = containerOf(nb);
    if (!c) continue;
    for (let i = 0; i < c.size; i++) {
      const s = c.getItem(i);
      if (!s || !packable(s)) continue;
      const p = packItem(s);
      p.n = Math.min(p.n, max);
      const took = accept(p);
      if (took > 0) {
        if (s.amount > took) {
          s.amount -= took;
          c.setItem(i, s);
        } else c.setItem(i, undefined);
        break;
      }
    }
  }
}

/** Contents of a container as packed items (non-empty slots). */
export function packedContents(container) {
  const out = [];
  for (let i = 0; i < container.size; i++) {
    const s = container.getItem(i);
    if (s) out.push(packItem(s));
  }
  return out;
}

export function dropSlots(dim, pos, slots) {
  for (const p of slots ?? []) {
    let left = p?.n ?? 0;
    while (left > 0) {
      const s = unpackItem({ ...p, n: left });
      if (!s) break;
      dim.spawnItem(s, center(pos));
      left -= s.amount;
    }
  }
}

export function stackOf(id, n = 1) {
  try {
    return new ItemStack(id, n);
  } catch {
    return undefined;
  }
}
