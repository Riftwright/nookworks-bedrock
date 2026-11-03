// Tools and items with behaviour (docs/java_spec.md §16): hammers' 3x3, magnets, Building Wand, Wrench, Lode Pearl,
// Mob Bottle, Fine Shears, Fireproof Coating.
import { world, system, ItemStack } from "@minecraft/server";
import { onAnyBreak } from "../lib/blocks.js";
import { DIRS, add, blockAt, held, setHeld, isCreative, give, tr, actionbar, safe, setStates, state } from "../lib/util.js";
import { breakAll, canHarvest } from "./chain_breaking.js";
import { setting } from "./settings.js";

// ---- Hammers: 3x3 in the plane facing the player; neighbours no harder than twice the centre + 0.5
const SPARES = /budding_amethyst|spawner|bedrock|end_portal|barrier|command_block/;
onAnyBreak(({ block, dim, perm, player, item }) => {
  if (!player || !item?.typeId.endsWith("_hammer") || !item.typeId.startsWith("nookworks:")) return;
  if (!setting("hammer") || player.isSneaking) return;
  const v = player.getViewDirection();
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  const plane = ay > ax && ay > az ? "y" : ax > az ? "x" : "z";
  const o = block.location;
  const targets = [];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      const p = plane === "y" ? { x: o.x + a, y: o.y, z: o.z + b } : plane === "x" ? { x: o.x, y: o.y + a, z: o.z + b } : { x: o.x + a, y: o.y + b, z: o.z };
      const nb = blockAt(dim, p);
      if (!nb || nb.isAir || nb.isLiquid || SPARES.test(nb.typeId)) continue;
      if (!nb.hasTag("stone") && !nb.hasTag("metal") && !nb.hasTag("minecraft:is_pickaxe_item_destructible") && !/ore|stone|deepslate|netherrack|basalt|blackstone|tuff|calcite|terracotta|brick|end_stone|obsidian/.test(nb.typeId)) continue;
      if (!canHarvest(nb, item)) continue;
      targets.push(p);
    }
  breakAll(player, dim, targets);
});

// ---- Magnets: switched on (right-click), anywhere in the inventory, pull items (8 / 16 blocks) and XP orbs
world.afterEvents.itemUse.subscribe(
  safe((e) => {
    const s = e.itemStack;
    if (s.typeId !== "nookworks:magnet" && s.typeId !== "nookworks:advanced_magnet") return;
    const on = !s.getDynamicProperty("on");
    s.setDynamicProperty("on", on);
    s.setLore(on ? ["§aON"] : ["§7OFF"]);
    setHeld(e.source, s);
    e.source.playSound(on ? "random.orb" : "random.click");
    actionbar(e.source, tr(on ? "nookworks.bedrock.on" : "nookworks.bedrock.off"));
  }, "magnet toggle")
);
system.runInterval(
  safe(() => {
    if (!setting("magnet")) return;
    for (const p of world.getAllPlayers()) {
      if (p.isSneaking) continue;
      const inv = p.getComponent("minecraft:inventory")?.container;
      if (!inv) continue;
      let range = 0;
      for (let i = 0; i < inv.size; i++) {
        const s = inv.getItem(i);
        if (!s || !s.getDynamicProperty?.("on")) continue;
        if (s.typeId === "nookworks:advanced_magnet") range = 16;
        else if (s.typeId === "nookworks:magnet") range = Math.max(range, 8);
      }
      if (!range) continue;
      const to = { x: p.location.x, y: p.location.y + 0.5, z: p.location.z };
      for (const e of p.dimension.getEntities({ location: to, maxDistance: range })) {
        if (e.typeId !== "minecraft:item" && e.typeId !== "minecraft:xp_orb") continue;
        e.teleport(to);
      }
    }
  }, "magnets"),
  5
);

// ---- Building Wand: copies the clicked block over the flat face of identical blocks (max 32, reach 8)
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.itemStack?.typeId !== "nookworks:building_wand" || !setting("buildingWand")) return;
  e.cancel = true;
  const { block, player, blockFace } = e;
  system.run(safe(() => wand(player, block, blockFace), "wand"));
});
const FACE = { Up: "up", Down: "down", North: "north", South: "south", East: "east", West: "west" };
function wand(player, block, face) {
  const dir = DIRS[FACE[face]];
  const perm = block.permutation;
  const type = block.typeId;
  const dim = block.dimension;
  const axes = dir.y ? [DIRS.north, DIRS.south, DIRS.east, DIRS.west] : dir.x ? [DIRS.up, DIRS.down, DIRS.north, DIRS.south] : [DIRS.up, DIRS.down, DIRS.east, DIRS.west];
  const seen = new Set();
  const queue = [block.location];
  const places = [];
  while (queue.length && places.length < 32 && seen.size < 256) {
    const p = queue.shift();
    const k = `${p.x},${p.y},${p.z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockAt(dim, p);
    if (b?.typeId !== type) continue;
    const front = blockAt(dim, add(p, dir));
    if (!front || !(front.isAir || front.isLiquid)) continue;
    if (Math.abs(p.x - block.location.x) > 8 || Math.abs(p.y - block.location.y) > 8 || Math.abs(p.z - block.location.z) > 8) continue;
    places.push(front);
    for (const a of axes) queue.push(add(p, a));
  }
  const creative = isCreative(player);
  const inv = player.getComponent("minecraft:inventory").container;
  let placed = 0;
  for (const f of places) {
    if (!creative && !takeOne(inv, type)) break;
    f.setPermutation(perm);
    placed++;
  }
  if (placed) {
    dim.playSound("use.stone", block.location);
    if (!creative) wearHeld(player, 1);
  }
}
function takeOne(inv, typeId) {
  for (let i = 0; i < inv.size; i++) {
    const s = inv.getItem(i);
    if (s?.typeId === typeId) {
      if (s.amount > 1) {
        s.amount--;
        inv.setItem(i, s);
      } else inv.setItem(i, undefined);
      return true;
    }
  }
  return false;
}
function wearHeld(player, n) {
  const h = held(player);
  const dur = h?.getComponent("minecraft:durability");
  if (!dur) return;
  if (dur.damage + n >= dur.maxDurability) {
    setHeld(player, undefined);
    player.playSound("random.break");
  } else {
    dur.damage += n;
    setHeld(player, h);
  }
}

// ---- Wrench: rotates a block (sneak: the other way)
const CARD = ["north", "east", "south", "west"];
const SIX = ["down", "up", "north", "south", "west", "east"];
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.itemStack?.typeId !== "nookworks:wrench") return;
  const b = e.block;
  if (/fence|wall|pane|redstone_wire|portal|dice/.test(b.typeId)) return;
  const states = b.permutation.getAllStates();
  const key = ["minecraft:cardinal_direction", "minecraft:facing_direction", "facing_direction", "direction", "minecraft:block_face"].find((k) => k in states);
  if (!key) return;
  e.cancel = true;
  const back = e.player.isSneaking;
  system.run(() => {
    let v = states[key];
    if (typeof v === "number") v = (v + (back ? 3 : 1)) % (key === "direction" ? 4 : 6);
    else {
      const list = CARD.includes(v) && key !== "minecraft:facing_direction" && key !== "minecraft:block_face" ? CARD : SIX;
      v = list[(list.indexOf(v) + (back ? list.length - 1 : 1)) % list.length];
    }
    try {
      b.setPermutation(b.permutation.withState(key, v));
      b.dimension.playSound("random.click", b.location, { pitch: 1.4 });
      if (!isCreative(e.player)) wearHeld(e.player, 1);
    } catch {}
  });
});

// ---- Lode Pearl: an ender pearl used on a lodestone becomes bound; thrown, it takes you there (any dimension)
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.block.typeId !== "minecraft:lodestone") return;
  const id = e.itemStack?.typeId;
  if (id !== "minecraft:ender_pearl" && id !== "nookworks:lode_pearl") return;
  e.cancel = true;
  const { player, block } = e;
  system.run(() => {
    const s = new ItemStack("nookworks:lode_pearl", 1);
    const target = { dim: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z };
    s.setDynamicProperty("target", JSON.stringify(target));
    s.setLore([`§7${target.x}, ${target.y}, ${target.z}`]);
    const h = held(player);
    if (h.amount > 1 && id === "minecraft:ender_pearl") {
      h.amount--;
      setHeld(player, h);
      give(player, s);
    } else setHeld(player, s);
    player.playSound("block.lodestone_compass.link_compass_to_lodestone");
  });
});
world.afterEvents.itemUse.subscribe(
  safe((e) => {
    if (e.itemStack.typeId !== "nookworks:lode_pearl") return;
    const raw = e.itemStack.getDynamicProperty("target");
    const player = e.source;
    if (!raw) return;
    const t = JSON.parse(raw);
    const dim = world.getDimension(t.dim);
    if (!isCreative(player)) setHeld(player, undefined);
    system.runTimeout(() => {
      const lode = blockAt(dim, t);
      if (lode && lode.typeId !== "minecraft:lodestone") {
        give(player, new ItemStack("minecraft:ender_pearl", 1));
        return;
      }
      player.teleport({ x: t.x + 0.5, y: t.y + 1, z: t.z + 0.5 }, { dimension: dim });
      player.playSound("mob.endermen.portal");
    }, 10);
  }, "lode pearl")
);

// ---- Mob Bottle: right-click a mob at half health or less to capture it; right-click a block to let it out
const NOT_BOTTLED = /ender_dragon|wither$|elder_guardian|warden|vex|player/;
world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
  const s = e.itemStack;
  if (s?.typeId !== "nookworks:mob_bottle" || s.getDynamicProperty("mob")) return;
  const mob = e.target;
  if (NOT_BOTTLED.test(mob.typeId)) return;
  const hp = mob.getComponent("minecraft:health");
  if (!hp || (hp.currentValue > hp.effectiveMax / 2 && mob.typeId !== "minecraft:villager_v2")) {
    system.run(() => actionbar(e.player, tr("nookworks.bedrock.mob_bottle_hurt")));
    return;
  }
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    const filled = new ItemStack("nookworks:mob_bottle", 1);
    filled.setDynamicProperty("mob", mob.typeId);
    if (mob.nameTag) filled.setDynamicProperty("name", mob.nameTag);
    filled.setLore([`§7${mob.typeId.replace("minecraft:", "")}`]);
    mob.remove();
    const h = held(player);
    if (h?.amount > 1) {
      h.amount--;
      setHeld(player, h);
      give(player, filled);
    } else setHeld(player, filled);
    player.playSound("bottle.fill");
  });
});
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const s = e.itemStack;
  if (!e.isFirstEvent || s?.typeId !== "nookworks:mob_bottle" || !s.getDynamicProperty("mob")) return;
  e.cancel = true;
  const type = s.getDynamicProperty("mob");
  const name = s.getDynamicProperty("name");
  const { player, block, blockFace } = e;
  system.run(() => {
    const p = add(block.location, DIRS[FACE[blockFace]]);
    const mob = block.dimension.spawnEntity(type, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    if (name) mob.nameTag = name;
    setHeld(player, new ItemStack("nookworks:mob_bottle", 1));
    player.playSound("bottle.empty");
  });
});
