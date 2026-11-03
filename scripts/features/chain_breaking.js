// Tree felling (axe on a grown log) and vein mining (pickaxe on an ore), as feature/ChainBreaking: up to 256 logs
// / 64 ore blocks, over all 26 neighbours, nearest first; sneak to break just one. Logs a player placed are never
// taken (a cabin against a tree stays up). Leaves of a felled tree decay within seconds.
import { world, system } from "@minecraft/server";
import { onAnyBreak, onAnyPlace } from "../lib/blocks.js";
import { blockAt, safe, isCreative, later } from "../lib/util.js";
import { setting } from "./settings.js";

const LOG = /(_log|_stem|_wood|_hyphae)$|^minecraft:(mangrove_roots|bamboo_block)$/;
const LEAVES = /leaves$|^minecraft:(nether_wart_block|warped_wart_block|shroomlight)$/;
const ORE = /_ore$|^minecraft:(ancient_debris|lit_redstone_ore|lit_deepslate_redstone_ore)$/;

let busy = false;

// ---- logs players placed (per chunk, saved)
const placedCache = new Map();
const chunkKey = (dim, p) => `pl|${dim}|${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
function placedSet(dim, p) {
  const k = chunkKey(dim, p);
  let s = placedCache.get(k);
  if (!s) {
    const raw = world.getDynamicProperty(k);
    s = new Set(raw ? JSON.parse(raw) : []);
    placedCache.set(k, s);
  }
  return [k, s];
}
function markPlaced(dim, p, on) {
  const [k, s] = placedSet(dim, p);
  const pk = `${p.x},${p.y},${p.z}`;
  if (on === s.has(pk)) return;
  on ? s.add(pk) : s.delete(pk);
  world.setDynamicProperty(k, s.size ? JSON.stringify([...s]) : undefined);
}
export function isPlacedLog(dim, p) {
  return placedSet(dim, p)[1].has(`${p.x},${p.y},${p.z}`);
}
onAnyPlace(({ block, dim }) => {
  if (LOG.test(block.typeId)) markPlaced(dim.id, block.location, true);
});

function family(typeId) {
  return typeId.replace("deepslate_", "").replace("lit_", "").replace("nether_gold", "gold");
}

function search(dim, origin, takes, limit) {
  const found = [];
  const seen = new Set([`${origin.x},${origin.y},${origin.z}`]);
  const queue = [origin];
  while (queue.length && found.length < limit) {
    const c = queue.shift();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (found.length >= limit) return found;
          const p = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
          const k = `${p.x},${p.y},${p.z}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const b = blockAt(dim, p);
          if (b && takes(b, p)) {
            found.push(p);
            queue.push(p);
          }
        }
  }
  return found;
}

function hasNaturalCrown(dim, logs) {
  for (const l of logs)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = blockAt(dim, { x: l.x + dx, y: l.y + dy, z: l.z + dz });
          if (b && LEAVES.test(b.typeId)) {
            let persistent = false;
            try {
              persistent = b.permutation.getState("persistent_bit") === true;
            } catch {}
            if (!persistent) return true;
          }
        }
  return false;
}

const TIERS = ["wooden", "golden", "stone", "copper", "iron", "diamond", "netherite"];
function toolTier(item) {
  for (let i = TIERS.length - 1; i >= 0; i--) if (item.hasTag(`minecraft:${TIERS[i]}_tier`)) return TIERS[i];
  if (item.typeId.startsWith("nookworks:velarium")) return "netherite";
  return "wooden";
}
export function canHarvest(block, item) {
  // minecraft:<tier>_tier_destructible names the lowest tier that drops it (the older *_pick_diggable tags list
  // every pickaxe that may dig it, so they say nothing about the least one)
  const t = TIERS.indexOf(toolTier(item));
  for (const need of ["netherite", "diamond", "iron", "copper", "stone"])
    if (block.hasTag(`minecraft:${need}_tier_destructible`)) return t >= TIERS.indexOf(need);
  return true;
}

/** Breaks blocks as the player's tool would (its enchantments apply), wearing the tool; stops before it breaks. */
export function breakAll(player, dim, targets) {
  busy = true;
  try {
    const creative = isCreative(player);
    for (const p of targets) {
      const inv = player.getComponent("minecraft:inventory").container;
      const slot = player.selectedSlotIndex;
      const tool = inv.getItem(slot);
      if (!creative && tool) {
        const dur = tool.getComponent("minecraft:durability");
        if (dur) {
          if (setting("protectTools") && dur.damage >= dur.maxDurability - 1) break;
          if (Math.random() * 100 < dur.getDamageChance(tool.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0)) {
            if (dur.damage + 1 >= dur.maxDurability) {
              inv.setItem(slot, undefined);
              dim.playSound("random.break", player.location);
            } else {
              dur.damage += 1;
              inv.setItem(slot, tool);
            }
          }
        }
      }
      const { x, y, z } = p;
      if (creative) dim.runCommand(`setblock ${x} ${y} ${z} air`);
      else {
        player.runCommand(`loot spawn ${x} ${y} ${z} mine ${x} ${y} ${z} mainhand`);
        dim.runCommand(`setblock ${x} ${y} ${z} air`);
      }
      markPlaced(dim.id, p, false);
      if (!inv.getItem(slot) && !creative) break;
    }
  } finally {
    busy = false;
  }
}

onAnyBreak(({ block, dim, perm, player, item, typeId }) => {
  const wasPlaced = isPlacedLog(dim.id, block.location);
  markPlaced(dim.id, block.location, false);
  if (busy || !player || !item) return;
  const origin = block.location;
  if (LOG.test(typeId) && item.hasTag("minecraft:is_axe") && setting("timber") && !player.isSneaking) {
    if (wasPlaced) return;
    const logs = search(dim, origin, (b, p) => p.y >= origin.y && b.typeId === typeId && !isPlacedLog(dim.id, p), setting("timberMax"));
    if (!hasNaturalCrown(dim, [origin, ...logs])) return;
    breakAll(player, dim, logs);
    if (setting("fastLeafDecay")) fastLeafDecay(dim, [origin, ...logs]);
    rootbound(player, item, dim, origin, typeId);
  } else if (ORE.test(typeId) && item.hasTag("minecraft:is_pickaxe") && !item.hasTag("nookworks:hammer") && setting("veinMining") && !player.isSneaking) {
    const fam = family(typeId);
    const ores = search(dim, origin, (b) => ORE.test(b.typeId) && family(b.typeId) === fam && canHarvest(b, item), setting("veinMax"));
    breakAll(player, dim, ores);
    const xp = { coal: [0, 2], diamond: [3, 7], emerald: [3, 7], lapis: [2, 5], redstone: [1, 5], quartz: [2, 5], nether_gold: [0, 1] };
    const kind = Object.keys(xp).find((k) => typeId.includes(k));
    const silk = item.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch");
    if (kind && !silk && !isCreative(player))
      for (const o of ores) {
        const [lo, hi] = xp[kind];
        for (let n = lo + Math.floor(Math.random() * (hi - lo + 1)); n > 0; n--) dim.spawnEntity("minecraft:xp_orb", { x: o.x + 0.5, y: o.y + 0.5, z: o.z + 0.5 });
      }
  }
});

/** A felled tree's leaves (not placed ones) fall within a few seconds, with their drops. */
function fastLeafDecay(dim, logs) {
  // found a little at a time (a big tree has tens of thousands of places around it), then dropped a few a tick
  system.runJob(
    (function* () {
      const leaves = [];
      const seen = new Set();
      for (const l of logs) {
        for (let dx = -5; dx <= 5; dx++)
          for (let dy = -3; dy <= 5; dy++)
            for (let dz = -5; dz <= 5; dz++) {
              const p = { x: l.x + dx, y: l.y + dy, z: l.z + dz };
              const k = `${p.x},${p.y},${p.z}`;
              if (seen.has(k)) continue;
              seen.add(k);
              const b = blockAt(dim, p);
              if (!b || !/leaves$/.test(b.typeId)) continue;
              try {
                if (b.permutation.getState("persistent_bit")) continue;
              } catch {}
              leaves.push(p);
            }
        yield;
      }
      leaves.sort(() => Math.random() - 0.5);
      let i = 0;
      while (i < leaves.length) {
        for (let n = 0; n < 6 && i < leaves.length; n++, i++) {
          const p = leaves[i];
          const b = blockAt(dim, p);
          if (b && /leaves$/.test(b.typeId) && !nearLog(dim, p)) dim.runCommand(`setblock ${p.x} ${p.y} ${p.z} air destroy`);
        }
        for (let w = 0; w < 2; w++) yield;
      }
    })()
  );
}

function nearLog(dim, p) {
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++) {
        const b = blockAt(dim, { x: p.x + dx, y: p.y + dy, z: p.z + dz });
        if (b && LOG.test(b.typeId) && !isPlacedLog(dim.id, b.location)) return true;
      }
  return false;
}

// Rootbound (Java: an axe enchantment) is the Rootbound item's mark on an axe, set in features/rootbound.js
let rootboundHook = null;
export function setRootboundHook(fn) {
  rootboundHook = fn;
}
function rootbound(player, item, dim, origin, typeId) {
  rootboundHook?.(player, item, dim, origin, typeId);
}
