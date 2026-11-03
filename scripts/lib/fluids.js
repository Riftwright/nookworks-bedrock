// Liquids as numbers (mB), as Bedrock has no custom fluids: tanks in block data, moved along Copper Pipes.
// Buckets and bottles pour in and fill from any block with a tank.
import { DIRS, add, blockAt, posKey, parseKey, id, tr } from "./util.js";
import { worldVersion } from "./blocks.js";
import * as store from "./store.js";
import { world } from "@minecraft/server";

export const FLUIDS = {
  water: { color: "§9" }, lava: { color: "§6" }, vegetable_oil: { color: "§e" }, biodiesel: { color: "§6" },
  experience: { color: "§a" }, mercury: { color: "§7" },
};

/** Filled containers: item -> [fluid, mB, empty container] */
export const FILLED = {
  "minecraft:water_bucket": ["water", 1000, "minecraft:bucket"],
  "minecraft:lava_bucket": ["lava", 1000, "minecraft:bucket"],
  "nookworks:vegetable_oil_bucket": ["vegetable_oil", 1000, "minecraft:bucket"],
  "nookworks:vegetable_oil_bottle": ["vegetable_oil", 250, "minecraft:glass_bottle"],
  "nookworks:biodiesel_bucket": ["biodiesel", 1000, "minecraft:bucket"],
  "nookworks:biodiesel_bottle": ["biodiesel", 250, "minecraft:glass_bottle"],
  "nookworks:experience_bucket": ["experience", 1000, "minecraft:bucket"],
  "nookworks:liquid_experience_bottle": ["experience", 250, "minecraft:glass_bottle"],
  "nookworks:mercury_bucket": ["mercury", 1000, "minecraft:bucket"],
};
/** [empty container, fluid] -> filled item */
export function filledOf(empty, f) {
  for (const [item, [fl, , e]] of Object.entries(FILLED)) if (e === empty && fl === f) return [item, FILLED[item][1]];
  return null;
}

export function fluidName(f) {
  return tr(`gui.nookworks.tank.${f}`);
}


export const PIPES = new Set([id("copper_pipe"), id("valve"), id("sight_glass"), id("experience_pipe"), id("mercury_pipe")]);
/** typeId -> (block) => [{tank, accepts(f), gives}] ports a pipe network can reach */
export const fluidHolders = new Map();

export function registerFluidHolder(name, fn) {
  fluidHolders.set(id(name), fn);
}

/** Puts up to n of fluid f into tank t (cap). Returns amount taken. */
export function fill(t, cap, f, n) {
  if (t.f && t.f !== f && t.n > 0) return 0;
  const k = Math.min(n, cap - t.n);
  if (k <= 0) return 0;
  t.f = f;
  t.n += k;
  return k;
}

export function drain(t, n) {
  const k = Math.min(n, t.n);
  t.n -= k;
  if (t.n <= 0) {
    t.n = 0;
    t.f = null;
  }
  return k;
}

const cache = new Map();
/** Holders reached through pipes from a block (valves closed stop the walk). */
export function reach(block) {
  const k = posKey(block.dimension, block.location);
  const c = cache.get(k);
  if (c && c.v === worldVersion()) return c.list;
  const dim = block.dimension;
  const seen = new Set([k]);
  const out = [];
  const queue = [block.location];
  let steps = 0;
  while (queue.length && steps++ < 1024) {
    const p = queue.shift();
    for (const d of Object.values(DIRS)) {
      const q = add(p, d);
      const qk = posKey(dim, q);
      if (seen.has(qk)) continue;
      seen.add(qk);
      const b = blockAt(dim, q);
      if (!b) continue;
      if (PIPES.has(b.typeId)) {
        if (b.typeId === id("valve") && b.permutation.getState("nookworks:open") === false) continue;
        queue.push(q);
      } else if (fluidHolders.has(b.typeId)) out.push(qk);
    }
  }
  cache.set(k, { v: worldVersion(), list: out });
  return out;
}

/** Pushes up to n of fluid f from block through pipes into tanks that accept it; returns the amount moved. */
export function pushFluid(block, f, n) {
  let moved = 0;
  for (const k of reach(block)) {
    if (moved >= n) break;
    const { dim, pos } = parseKey(k);
    const b = blockAt(world.getDimension(dim), pos);
    if (!b) continue;
    const ports = fluidHolders.get(b.typeId)?.(b) ?? [];
    for (const port of ports) {
      if (moved >= n) break;
      if (port.accepts && !port.accepts(f)) continue;
      const got = fill(port.tank, port.cap, f, n - moved);
      if (got) {
        moved += got;
        store.saveKey(k);
      }
    }
  }
  return moved;
}

/** Pulls fluid out of reachable holders that give it (ports with gives: true) into tank t. */
export function pullFluid(block, t, cap, accepts, n) {
  let moved = 0;
  for (const k of reach(block)) {
    if (moved >= n) break;
    const { dim, pos } = parseKey(k);
    const b = blockAt(world.getDimension(dim), pos);
    if (!b) continue;
    for (const port of fluidHolders.get(b.typeId)?.(b) ?? []) {
      if (!port.gives || !port.tank.f || port.tank.n <= 0) continue;
      if (accepts && !accepts(port.tank.f)) continue;
      if (t.f && t.f !== port.tank.f) continue;
      const f = port.tank.f;
      const k2 = Math.min(n - moved, cap - t.n, port.tank.n);
      if (k2 <= 0) continue;
      drain(port.tank, k2);
      fill(t, cap, f, k2);
      moved += k2;
      store.saveKey(k);
    }
  }
  return moved;
}
