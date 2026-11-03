// Motor, Drive Wheels and belts (docs/java_spec.md §8). A powered Motor turns once every 10 ticks: the hand machine
import { redstoneIn } from "../lib/blocks.js";
// at its shaft, or a Drive Wheel there and everything that wheel reaches by belts and shared axles, up to 8 machines,
// 20 FE/t each with work (2 FE/t idle). Belts: use Rope (8 blocks) or Thin Chain (16) on one wheel then another;
// 2 items per block of length. Sneak + empty hand on a wheel takes its belts off.
import { world, system, ItemStack } from "@minecraft/server";
import { defineMachine, machines, useEnergy, withSlots } from "../lib/machine.js";
import { onBlock, TICK } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { DIRS, OPPOSITE, add, blockAt, held, isCreative, tr, actionbar, safe, setStates, state, posKey, parseKey } from "../lib/util.js";
import { setting } from "./settings.js";

const WHEEL = "nookworks:drive_wheel";
const CRANKABLE = new Set(["nookworks:hand_quern", "nookworks:noodle_maker", "nookworks:rice_polisher", "nookworks:oil_press"]);
const dirOf = (b) => state(b, "minecraft:facing_direction") ?? state(b, "minecraft:cardinal_direction") ?? "north";

function wheelData(b) {
  return store.get(b, () => ({ belts: [] }));
}

/** Machines driven from a wheel: walks belts and wheels on one axle, nearest first. */
function driven(start) {
  const out = [];
  const seen = new Set();
  const queue = [start];
  while (queue.length && seen.size < 32 && out.length < 8) {
    const w = queue.shift();
    const k = posKey(w.dimension, w.location);
    if (seen.has(k)) continue;
    seen.add(k);
    const f = dirOf(w);
    // the machine its face rests on
    const m = blockAt(w.dimension, add(w.location, DIRS[f]));
    if (m && CRANKABLE.has(m.typeId)) out.push(m);
    // wheels end to end on one axle
    for (const d of [f, OPPOSITE[f]]) {
      const n = blockAt(w.dimension, add(w.location, DIRS[d]));
      if (n?.typeId === WHEEL) queue.push(n);
    }
    for (const bk of wheelData(w).belts ?? []) {
      const { dim, pos } = parseKey(bk.to);
      const n = blockAt(world.getDimension(dim), pos);
      if (n?.typeId === WHEEL) queue.push(n);
    }
  }
  return out;
}

defineMachine("motor", {
  energy: { cap: 10000, in: true },
  work({ block, d }) {
    if (redstoneIn(block) > 0) return "redstone";
    const f = dirOf(block);
    const shaft = blockAt(block.dimension, add(block.location, DIRS[f]));
    let targets = [];
    if (shaft && CRANKABLE.has(shaft.typeId)) targets = [shaft];
    else if (shaft?.typeId === WHEEL) targets = driven(shaft);
    const working = targets.filter((m) => {
      const spec = machines.get(m.typeId);
      return withSlots(spec, m, (md) => !!md.slots?.[0]);
    });
    const cost = Math.ceil((working.length ? 20 * working.length : 2) * setting("machineEnergy")) * TICK;
    if (!useEnergy(d, cost)) {
      setStates(block, { powered: false });
      return "no_power";
    }
    setStates(block, { powered: true });
    if (shaft?.typeId === WHEEL) setStates(shaft, { turning: working.length > 0 });
    for (const m of working) {
      const spec = machines.get(m.typeId);
      withSlots(spec, m, (md) => spec.crank(m, md));
    }
    return working.length ? "running" : "idle";
  },
});

// ---- belts
const BELT = { "nookworks:rope": 8, "nookworks:thin_chain": 16, "nookworks:thin_rope": 8 };
const pending = new Map();
onBlock("drive_wheel", {
  interact: ({ block, player }) => {
    const h = held(player);
    if (!h && player.isSneaking) return unbelt(block, player);
    if (!h || !BELT[h.typeId]) return;
    const p = pending.get(player.id);
    const k = posKey(block.dimension, block.location);
    if (!p || p.item !== h.typeId || p.key === k || system.currentTick - p.tick > 600) {
      pending.set(player.id, { key: k, item: h.typeId, tick: system.currentTick });
      return actionbar(player, tr("nookworks.bedrock.belt_started"));
    }
    pending.delete(player.id);
    const a = blockAt(block.dimension, parseKey(p.key).pos);
    if (!a || a.typeId !== WHEEL) return;
    const len = Math.hypot(a.location.x - block.location.x, a.location.y - block.location.y, a.location.z - block.location.z);
    if (len > BELT[h.typeId]) return actionbar(player, tr("nookworks.bedrock.rope_too_long"));
    const da = wheelData(a), db = wheelData(block);
    if (da.belts.length >= 2 || db.belts.length >= 2) return actionbar(player, tr("nookworks.bedrock.belt_full"));
    const cost = Math.ceil(len) * 2;
    if (!isCreative(player) && !take(player, h.typeId, cost)) return actionbar(player, tr("nookworks.bedrock.rope_needs", cost));
    // drawn as a span between the wheel centres
    const ca = a.center(), cb = block.center();
    const span = block.dimension.spawnEntity(h.typeId === "nookworks:thin_chain" ? "nookworks:chain_span" : "nookworks:rope_span", ca);
    const dx = cb.x - ca.x, dy = cb.y - ca.y, dz = cb.z - ca.z;
    span.setRotation({ x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI });
    span.setProperty("nookworks:length", len);
    span.setProperty("nookworks:pitch", (Math.asin(dy / len) * 180) / Math.PI);
    span.setDynamicProperty("belt", true);
    da.belts.push({ to: k, item: h.typeId, cost, span: span.id });
    db.belts.push({ to: p.key, item: h.typeId, cost: 0, span: span.id });
    store.save(a);
    store.save(block);
  },
  broken: ({ block }) => unbelt(block),
});

function unbelt(block, player) {
  const d = store.getKey(store.keyOf(block));
  for (const b of d?.belts ?? []) {
    try {
      world.getEntity(b.span)?.remove();
    } catch {}
    if (b.cost && !(player && isCreative(player))) block.dimension.spawnItem(new ItemStack(b.item, Math.min(64, b.cost)), block.center());
    const { dim, pos } = parseKey(b.to);
    const other = blockAt(world.getDimension(dim), pos);
    if (other?.typeId === WHEEL) {
      const od = wheelData(other);
      const back = od.belts.find((x) => x.to === store.keyOf(block));
      if (back?.cost && !(player && isCreative(player))) block.dimension.spawnItem(new ItemStack(back.item, Math.min(64, back.cost)), block.center());
      od.belts = od.belts.filter((x) => x.to !== store.keyOf(block));
      store.save(other);
    }
  }
  if (d) {
    d.belts = [];
    store.saveKey(store.keyOf(block));
  }
}

function take(player, id, n) {
  const inv = player.getComponent("minecraft:inventory").container;
  let have = 0;
  for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === id) have += inv.getItem(i).amount;
  if (have < n) return false;
  for (let i = 0; i < inv.size && n > 0; i++) {
    const s = inv.getItem(i);
    if (s?.typeId !== id) continue;
    const k = Math.min(n, s.amount);
    n -= k;
    if (s.amount > k) {
      s.amount -= k;
      inv.setItem(i, s);
    } else inv.setItem(i, undefined);
  }
  return true;
}
