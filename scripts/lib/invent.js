// Chest-like screens for our blocks: an invisible entity with an inventory sits in the block, a little larger than
// it, so a tap opens the game's own container screen (Java's slots, as near as Bedrock gets).
//
//   registerInv("crate", { size: 9 })
//   registerInv("crusher", { size: 2, claims(player, held, block), use(player, block), form(player, block), title(block) })
//
// - empty hand (or any item the block does not claim): the container screen opens
// - an item the block claims (a bucket on a tank, a siftable on the Sifter...): use(player, block) instead
// - sneak: form(player, block) when there is one (settings, status, buttons)
// - hitting it a few times breaks the block, as mining it would
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { blockAt, safe, isCreative, short, held, id as nid } from "./util.js";
import { breakByPlayer } from "./blocks.js";
import { packItem, unpackItem } from "./store.js";
import { DATA } from "../generated/data.js";

export const invs = new Map(); // block typeId -> spec
const FAMILY = "nookworks_inv";
const ents = new Map(); // block key -> entity id

export function registerInv(name, spec) {
  invs.set(nid(name), spec);
}

const keyOf = (block) => `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;

export function title(typeId) {
  const s = short(typeId);
  return DATA.nameJa?.[s] ?? s;
}

/** The block's inventory entity, made if missing. */
export function entityOf(block, make = true) {
  const spec = invs.get(block.typeId);
  if (!spec) return undefined;
  const k = keyOf(block);
  const cached = ents.get(k);
  if (cached) {
    const e = world.getEntity(cached);
    if (e?.isValid && Math.floor(e.location.y + 0.1) === block.location.y) return e;
  }
  const c = { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
  const want = `nookworks:inv_${spec.size}`;
  const found = block.dimension
    .getEntities({ families: [FAMILY], location: { x: c.x, y: c.y - 0.025, z: c.z }, maxDistance: 0.3 })
    .find((e) => e.typeId === want && Math.floor(e.location.y + 0.1) === block.location.y);
  if (found) {
    ents.set(k, found.id);
    return found;
  }
  if (!make) return undefined;
  const e = block.dimension.spawnEntity(`nookworks:inv_${spec.size}`, { x: c.x, y: c.y - 0.025, z: c.z });
  e.nameTag = title(block.typeId);
  ents.set(k, e.id);
  return e;
}

export function containerOfBlock(block, make = true) {
  return entityOf(block, make)?.getComponent("minecraft:inventory")?.container;
}

/** Container -> packed slots (the first n). */
export function readSlots(block, n) {
  const c = containerOfBlock(block);
  if (!c) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = c.getItem(i);
    out.push(s ? packItem(s) : null);
  }
  return out;
}

/** Writes the slots that differ from what the container holds. */
export function writeSlots(block, slots) {
  const c = containerOfBlock(block);
  if (!c) return;
  for (let i = 0; i < slots.length && i < c.size; i++) {
    const cur = c.getItem(i);
    const a = cur ? JSON.stringify(packItem(cur)) : "null";
    if (a === JSON.stringify(slots[i] ?? null)) continue;
    const b = JSON.stringify(slots[i] ?? null);
    if (a !== b) c.setItem(i, slots[i] ? unpackItem(slots[i]) : undefined);
  }
}

/** Everything in the block's container, dropped at the block, and the entity gone. */
export function dropAndRemove(block, dim) {
  const e = entityOf(block, false);
  if (!e) return;
  const c = e.getComponent("minecraft:inventory")?.container;
  const at = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
  for (let i = 0; c && i < c.size; i++) {
    const s = c.getItem(i);
    if (s) (dim ?? block.dimension).spawnItem(s, at);
  }
  ents.delete(keyOf(block));
  e.remove();
}

export function removeQuietly(block) {
  const e = entityOf(block, false);
  ents.delete(keyOf(block));
  e?.remove();
}

function blockOf(e) {
  const l = e.location;
  return blockAt(e.dimension, { x: Math.floor(l.x), y: Math.floor(l.y + 0.1), z: Math.floor(l.z) });
}

// ---- taps
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const e = ev.target;
  if (!e.typeId.startsWith("nookworks:inv_")) return;
  const block = blockOf(e);
  const spec = block && invs.get(block.typeId);
  if (!spec) return;
  const player = ev.player;
  const h = ev.itemStack;
  if (player.isSneaking && spec.form) {
    ev.cancel = true;
    system.run(safe(() => spec.form(player, block), "inv form"));
    return;
  }
  if (spec.claims?.(player, h, block)) {
    ev.cancel = true;
    system.run(safe(() => spec.use(player, block), "inv use"));
    return;
  }
  // otherwise the game opens the container; bring its contents up to date first
  spec.beforeOpen?.(block);
});

// ---- hits break the block (a few for a machine, one in creative)
const hits = new Map();
world.afterEvents.entityHitEntity.subscribe(
  safe((ev) => {
    const e = ev.hitEntity;
    if (!e.typeId.startsWith("nookworks:inv_") || ev.damagingEntity?.typeId !== "minecraft:player") return;
    const player = ev.damagingEntity;
    const block = blockOf(e);
    if (!block || !invs.has(block.typeId)) return void e.remove();
    const k = keyOf(block);
    const now = system.currentTick;
    const h = hits.get(k);
    const count = h && now - h.t < 30 ? h.n + 1 : 1;
    hits.set(k, { n: count, t: now });
    block.dimension.playSound("dig.stone", block.location, { volume: 0.6 });
    const need = isCreative(player) ? 1 : (invs.get(block.typeId).hits ?? 3);
    if (count >= need) {
      hits.delete(k);
      breakByPlayer(block, player);
    }
  }, "inv hit")
);

// ---- tidy: an inventory entity whose block is gone drops what it held
system.runInterval(
  safe(() => {
    for (const d of ["overworld", "nether", "the_end"]) {
      const dim = world.getDimension(d);
      for (const e of dim.getEntities({ families: [FAMILY] })) {
        const b = blockOf(e);
        if (!b) continue; // unloaded
        if (!invs.has(b.typeId) || `nookworks:inv_${invs.get(b.typeId).size}` !== e.typeId) {
          const c = e.getComponent("minecraft:inventory")?.container;
          for (let i = 0; c && i < c.size; i++) {
            const s = c.getItem(i);
            if (s) dim.spawnItem(s, e.location);
          }
          e.remove();
        }
      }
    }
  }, "inv tidy"),
  40
);
