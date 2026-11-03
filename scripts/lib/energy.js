// Energy (Java's Forge Energy, here "FE" kept in block data): generators push into the machines their Energy
// Cables (or a face) reach. Networks are found by a walk over cables, cached until any of our blocks changes.
import { DIRS, add, blockAt, posKey, parseKey, id } from "./util.js";
import { worldVersion } from "./blocks.js";
import * as store from "./store.js";
import { world } from "@minecraft/server";

export const CABLE = id("energy_cable");
/** typeId -> {cap, in, out} for every block holding energy */
export const holders = new Map();

export function registerHolder(name, spec) {
  holders.set(id(name), spec);
}

const cache = new Map(); // key -> {v, list}

/** Energy holders (other than `block`) reached from it through cables or touching it. */
export function reach(block) {
  const k = posKey(block.dimension, block.location);
  const c = cache.get(k);
  if (c && c.v === worldVersion()) return c.list;
  const dim = block.dimension;
  const seen = new Set([k]);
  const out = [];
  const queue = [block.location];
  let steps = 0;
  let partial = false;
  while (queue.length && steps++ < 2048) {
    const p = queue.shift();
    for (const d of Object.values(DIRS)) {
      const q = add(p, d);
      const qk = posKey(dim, q);
      if (seen.has(qk)) continue;
      seen.add(qk);
      const b = blockAt(dim, q);
      if (!b) {
        partial = true; // part of it unloaded: walk again next time
        continue;
      }
      if (b.typeId === CABLE) queue.push(q);
      else if (holders.has(b.typeId)) out.push(qk);
    }
  }
  if (!partial) cache.set(k, { v: worldVersion(), list: out });
  return out;
}

export function data(block) {
  const spec = holders.get(block.typeId);
  const d = store.get(block, () => ({}));
  if (d.fe === undefined) d.fe = 0;
  return d;
}

/** Sends up to `amount` FE from `block` into what it reaches; returns how much went. */
export function push(block, amount) {
  if (amount <= 0) return 0;
  const targets = [];
  for (const k of reach(block)) {
    const { dim, pos } = parseKey(k);
    const b = blockAt(world.getDimension(dim), pos);
    if (!b) continue;
    const spec = holders.get(b.typeId);
    if (!spec || !spec.in) continue;
    const d = store.getKey(k, () => ({ fe: 0 }));
    const room = (spec.cap ?? 0) - (d.fe ?? 0);
    if (room > 0) targets.push({ k, d, room, spec });
  }
  let sent = 0;
  targets.sort((a, b) => a.room - b.room);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const share = Math.floor((amount - sent) / (targets.length - i));
    const n = Math.min(share, t.room);
    if (n > 0) {
      t.d.fe = (t.d.fe ?? 0) + n;
      store.saveKey(t.k);
      sent += n;
    }
  }
  return sent;
}

export function fmt(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${Math.floor(n)}`;
}
