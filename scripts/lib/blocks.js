// Behaviour registry for our blocks: one place that wires custom components and world events to handlers.
//
//   onBlock("crusher", { tick, interact, place, broken, randomTick, stepOn })
//
// Handlers get ({ block, player?, d?, ... }). `tick` runs through the block's minecraft:tick (every TICK ticks, set
// by tools/behaviors.py), only while its chunk is loaded.
import { world, system } from "@minecraft/server";
import { id, safe, short } from "./util.js";
import * as store from "./store.js";

export const TICK = 10;
export const handlers = new Map(); // typeId -> handler
const breakListeners = [];
const placeListeners = [];
let version = 0; // bumped on any of our blocks placed/broken: networks re-scan

export function onBlock(names, h) {
  for (const n of [].concat(names)) {
    const t = id(n);
    handlers.set(t, Object.assign(handlers.get(t) ?? {}, h));
  }
}

/** Blocks that use a tap only with certain items (a hoe on soil, a slab on a slab, an axe on a support...): they
 * are left out of nookworks:interactive (tools/item_tap_blocks.txt) and reached here instead. */
export const itemTaps = new Map(); // typeId -> (itemStack, player) => bool
export function onItemTap(names, pred) {
  for (const n of [].concat(names)) itemTaps.set(id(n), pred);
}
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent) return;
  const pred = itemTaps.get(e.block.typeId);
  if (!pred || !e.itemStack || !pred(e.itemStack, e.player)) return;
  e.cancel = true;
  const block = e.block, player = e.player, face = e.blockFace;
  system.run(
    safe(() => {
      const h = handlers.get(block.typeId);
      if (h?.interact) h.interact({ block, player, face });
    }, "itemTap")
  );
});

export function onAnyBreak(fn) {
  breakListeners.push(fn);
}
export function onAnyPlace(fn) {
  placeListeners.push(fn);
}
export const worldVersion = () => version;
export const bump = () => version++;

system.beforeEvents.startup.subscribe((ev) => {
  ev.blockComponentRegistry.registerCustomComponent("nookworks:ticking", {
    onTick: safe((e) => {
      const h = handlers.get(e.block.typeId);
      if (h?.tick) h.tick({ block: e.block, dim: e.dimension });
    }, "tick"),
  });
  ev.blockComponentRegistry.registerCustomComponent("nookworks:interactive", {
    onPlayerInteract: safe((e) => {
      const h = handlers.get(e.block.typeId);
      if (h?.interact && e.player) h.interact({ block: e.block, player: e.player, face: e.face, faceLocation: e.faceLocation });
    }, "interact"),
  });
  ev.blockComponentRegistry.registerCustomComponent("nookworks:behavior", {
    onRandomTick: safe((e) => {
      const h = handlers.get(e.block.typeId);
      if (h?.randomTick) h.randomTick({ block: e.block, dim: e.dimension });
    }, "randomTick"),
    onPlace: safe((e) => {
      version++;
      const h = handlers.get(e.block.typeId);
      if (h?.place) h.place({ block: e.block, previous: e.previousBlock });
    }, "place"),
    onStepOn: safe((e) => {
      const h = handlers.get(e.block.typeId);
      if (h?.stepOn) h.stepOn({ block: e.block, entity: e.entity });
    }, "stepOn"),
    onEntityFallOn: safe((e) => {
      const h = handlers.get(e.block.typeId);
      if (h?.fallOn) h.fallOn({ block: e.block, entity: e.entity, distance: e.fallDistance });
    }, "fallOn"),
  });
});

// Breaking: player breaks go through world events (they carry the broken permutation and the tool).
world.beforeEvents.playerBreakBlock.subscribe((e) => {
  const h = handlers.get(e.block.typeId);
  if (h?.beforeBreak) {
    const cancel = safe(h.beforeBreak, "beforeBreak")({ block: e.block, player: e.player, item: e.itemStack });
    if (cancel) e.cancel = true;
  }
});

world.afterEvents.playerBreakBlock.subscribe(
  safe((e) => {
    const typeId = e.brokenBlockPermutation.type.id;
    const ctx = { block: e.block, dim: e.dimension, perm: e.brokenBlockPermutation, player: e.player, item: e.itemStackBeforeBreak, typeId };
    for (const l of breakListeners) safe(l, "breakListener")(ctx);
    if (!typeId.startsWith("nookworks:")) return;
    version++;
    const h = handlers.get(typeId);
    if (h?.broken) h.broken(ctx);
    store.remove(e.block);
  }, "playerBreakBlock")
);

world.afterEvents.blockExplode.subscribe(
  safe((e) => {
    const typeId = e.explodedBlockPermutation.type.id;
    if (!typeId.startsWith("nookworks:")) return;
    version++;
    const h = handlers.get(typeId);
    if (h?.broken) h.broken({ block: e.block, dim: e.dimension, perm: e.explodedBlockPermutation, explosion: true, typeId });
    store.remove(e.block);
  }, "blockExplode")
);

world.afterEvents.playerPlaceBlock.subscribe(
  safe((e) => {
    for (const l of placeListeners) safe(l, "placeListener")({ block: e.block, player: e.player, dim: e.dimension });
    if (!e.block.typeId.startsWith("nookworks:")) return;
    version++;
    const h = handlers.get(e.block.typeId);
    if (h?.placedBy) h.placedBy({ block: e.block, player: e.player });
  }, "playerPlaceBlock")
);

export function shortId(block) {
  return short(block.typeId);
}

/** Breaks one of our blocks as a player's mining would (used where an inventory entity covers the block, so the
 * game's own mining never reaches it): handlers and listeners run, the block's loot drops (none in creative). */
export function breakByPlayer(block, player) {
  const perm = block.permutation;
  const typeId = block.typeId;
  const dim = block.dimension;
  const item = player?.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
  const ctx = { block, dim, perm, player, item, typeId };
  for (const l of breakListeners) safe(l, "breakListener")(ctx);
  version++;
  const h = handlers.get(typeId);
  if (h?.broken) safe(h.broken, "broken")(ctx);
  store.remove(block);
  const { x, y, z } = block.location;
  let creative = false;
  try {
    creative = player?.getGameMode?.() === "Creative" || player?.getGameMode?.() === "creative";
  } catch {}
  dim.runCommand(`setblock ${x} ${y} ${z} air${creative ? "" : " destroy"}`);
}

/** Redstone power reaching a block of ours: Bedrock's getRedstonePower() is undefined for custom blocks, so the
 * strongest of its six neighbours (a powered block, lever, torch, dust...). */
export function redstoneIn(block) {
  let p = 0;
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    try {
      const n = block.dimension.getBlock({ x: block.location.x + d[0], y: block.location.y + d[1], z: block.location.z + d[2] });
      if (!n) continue;
      p = Math.max(p, n.getRedstonePower() ?? 0);
    } catch {}
  }
  return p;
}
