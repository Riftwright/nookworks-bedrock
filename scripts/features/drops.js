// Block drops that depend on states or tools (Java loot tables in DATA.blockLoot, evaluated here): crops' ages,
// silk touch, shears... The blocks themselves have an empty Bedrock loot table.
import { ItemStack } from "@minecraft/server";
import { onAnyBreak } from "../lib/blocks.js";
import { roll } from "../lib/loot.js";
import { DATA } from "../generated/data.js";
import { world } from "@minecraft/server";
import { isCreative, safe } from "../lib/util.js";

export function statesOf(perm) {
  const out = {};
  for (const [k, v] of Object.entries(perm.getAllStates())) {
    const name = k.replace(/^nookworks:/, "");
    out[name] = v;
    if (k === "minecraft:cardinal_direction" || k === "minecraft:facing_direction") out.facing = v;
    if (k === "minecraft:vertical_half") out.half = v;
  }
  return out;
}

export function dropLoot(dim, pos, typeId, perm, ctx = {}) {
  const b = typeId.slice(10);
  const table = DATA.blockLoot[b];
  if (!table) return false;
  const tool = ctx.item;
  const silk = !!tool?.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch");
  const fortune = tool?.getComponent("minecraft:enchantable")?.getEnchantment("fortune")?.level ?? 0;
  const out = roll(table, { tool, silk, fortune, states: statesOf(perm), explosion: ctx.explosion, player: ctx.player });
  for (const o of out) {
    let n = o.n;
    while (n > 0) {
      let s;
      try {
        s = new ItemStack(o.id, Math.min(n, 64));
      } catch {
        break;
      }
      n -= s.amount;
      dim.spawnItem(s, { x: pos.x + 0.5, y: pos.y + 0.4, z: pos.z + 0.5 });
    }
  }
  return true;
}

onAnyBreak(({ block, dim, perm, player, item, typeId }) => {
  if (!typeId.startsWith("nookworks:") || !DATA.blockLoot[typeId.slice(10)]) return;
  if (player && isCreative(player)) return;
  dropLoot(dim, block.location, typeId, perm, { item, player });
});

world.afterEvents.blockExplode.subscribe(
  safe((e) => {
    const t = e.explodedBlockPermutation.type.id;
    if (t.startsWith("nookworks:") && DATA.blockLoot[t.slice(10)] && Math.random() < 0.5)
      dropLoot(e.dimension, e.block.location, t, e.explodedBlockPermutation, { explosion: true });
  }, "explodeDrops")
);
