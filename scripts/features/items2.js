// Small items with behaviour (docs/java_spec.md §6, §16): quenching Velarium, food poisoning, Soap, Fine Shears,
// Fireproof Coating, Oil Can, the Nook Dowsing Rod, Rootbound.
import { world, system, ItemStack } from "@minecraft/server";
import { DIRS, add, blockAt, held, setHeld, isCreative, tr, actionbar, safe, setStates, state, give } from "../lib/util.js";
import { DATA } from "../generated/data.js";
import { dataMapLookup } from "../lib/ids.js";
import { setRootboundHook } from "./chain_breaking.js";
import { onBlock } from "../lib/blocks.js";

const DIMS = () => ["overworld", "nether", "the_end"].map((d) => world.getDimension(d));

// ---- Quenching: a red-hot Velarium Ingot burns whoever holds it, cools after 600 t on the ground, and dropped
//      into a Vegetable Oil Cauldron becomes a Tempered Velarium Ingot (one level of oil a piece).
const HOT = "nookworks:red_hot_velarium_ingot";
system.runInterval(
  safe(() => {
    for (const p of world.getAllPlayers()) {
      const inv = p.getComponent("minecraft:inventory")?.container;
      if (!inv) continue;
      for (let i = 0; i < inv.size; i++) {
        const s = inv.getItem(i);
        if (s?.typeId !== HOT) continue;
        if (!p.getEffect("fire_resistance") && !isCreative(p)) {
          p.applyDamage(2, { cause: "fire" });
          inv.setItem(i, undefined);
          const e = p.dimension.spawnItem(s, p.location);
          e.setDynamicProperty("hotSince", system.currentTick);
        }
      }
    }
    for (const dim of DIMS())
      for (const e of dim.getEntities({ type: "minecraft:item" })) {
        const s = e.getComponent("minecraft:item")?.itemStack;
        if (s?.typeId !== HOT) continue;
        const since = e.getDynamicProperty("hotSince") ?? (e.setDynamicProperty("hotSince", system.currentTick), system.currentTick);
        const b = blockAt(dim, { x: Math.floor(e.location.x), y: Math.floor(e.location.y), z: Math.floor(e.location.z) });
        if (b?.typeId === "nookworks:vegetable_oil_cauldron") {
          const lvl = state(b, "level");
          dim.spawnItem(new ItemStack("nookworks:tempered_velarium_ingot", s.amount), add(b.location, { x: 0.5, y: 1, z: 0.5 }));
          dim.playSound("random.fizz", b.location);
          if (lvl > 1) setStates(b, { level: lvl - 1 });
          else b.setType("minecraft:cauldron");
          e.remove();
        } else if (system.currentTick - since > 600) {
          dim.spawnItem(new ItemStack("nookworks:velarium_ingot", s.amount), e.location);
          e.remove();
        }
      }
  }, "quench"),
  20
);
// a vegetable oil bucket into a cauldron makes the oil cauldron (3 levels); a bucket takes it back
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent) return;
  const id = e.itemStack?.typeId;
  if (e.block.typeId === "minecraft:cauldron" && id === "nookworks:vegetable_oil_bucket") {
    e.cancel = true;
    system.run(() => {
      e.block.setType("nookworks:vegetable_oil_cauldron");
      setStates(e.block, { level: 3 });
      if (!isCreative(e.player)) setHeld(e.player, new ItemStack("minecraft:bucket", 1));
    });
  } else if (e.block.typeId === "nookworks:vegetable_oil_cauldron" && id === "minecraft:bucket" && state(e.block, "level") === 3) {
    e.cancel = true;
    system.run(() => {
      e.block.setType("minecraft:cauldron");
      setHeld(e.player, new ItemStack("nookworks:vegetable_oil_bucket", 1));
    });
  }
});

// ---- Food poisoning: raw meat and fish may make you ill 60-120 s later (a warning 20 s before); milk cures
const pending = new Map();
world.afterEvents.itemCompleteUse.subscribe(
  safe((e) => {
    const p = e.source, id = e.itemStack.typeId;
    if (id === "minecraft:milk_bucket") return void pending.delete(p.id);
    const v = dataMapLookup(DATA.dataMaps["item/food_poisoning"], id);
    if (!v || isCreative(p) || Math.random() >= v.chance) return;
    const at = system.currentTick + 1200 + Math.floor(Math.random() * 1200);
    pending.set(p.id, { at, warn: at - 400, illness: v.illness, id });
  }, "food poisoning")
);
system.runInterval(
  safe(() => {
    for (const p of world.getAllPlayers()) {
      const f = pending.get(p.id);
      if (!f) continue;
      if (f.warn && system.currentTick >= f.warn) {
        p.sendMessage({ rawtext: [tr(`message.nookworks.food_poisoning.warning.${f.illness}`, { translate: new ItemStack(f.id).localizationKey })] });
        f.warn = 0;
      }
      if (system.currentTick >= f.at) {
        pending.delete(p.id);
        const long = f.illness === "mild" ? 300 : 600;
        p.addEffect("nausea", long);
        p.addEffect(f.illness === "parasite" ? "hunger" : "poison", f.illness === "mild" ? 200 : 400, { amplifier: f.illness === "severe" ? 1 : 0 });
      }
    }
  }, "illness"),
  20
);

// ---- Soap: washes the dye out of wool, carpet, glass, panes, terracotta; 16 uses
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
function washed(id) {
  const m = id.match(/^minecraft:([a-z_]+?)_(wool|carpet|stained_glass_pane|stained_glass|terracotta|concrete_powder)$/);
  if (!m || !COLORS.includes(m[1])) return null;
  return { wool: "minecraft:white_wool", carpet: "minecraft:white_carpet", stained_glass: "minecraft:glass", stained_glass_pane: "minecraft:glass_pane",
    terracotta: "minecraft:hardened_clay", concrete_powder: null }[m[2]];
}
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.itemStack?.typeId !== "nookworks:soap") return;
  const to = washed(e.block.typeId);
  const coated = isCoated(e.block);
  if (!to && !coated) return;
  e.cancel = true;
  const { block, player } = e;
  system.run(() => {
    if (to && to !== block.typeId) block.setType(to);
    if (coated) coat(block, false);
    wear(player);
    block.dimension.playSound("bucket.empty_water", block.location, { pitch: 1.6, volume: 0.4 });
  });
});
function wear(player) {
  if (isCreative(player)) return;
  const h = held(player);
  const d = h?.getComponent("minecraft:durability");
  if (!d) return;
  if (d.damage + 1 >= d.maxDurability) setHeld(player, undefined);
  else {
    d.damage++;
    setHeld(player, h);
  }
}

// ---- Fireproof Coating (64 uses): a coated block's neighbouring fire is put out before it can take
const coatKey = (b) => `fc|${b.dimension.id}`;
let coats = null;
function coatSet(dimId) {
  coats ??= {};
  coats[dimId] ??= new Set(JSON.parse(world.getDynamicProperty(`fc|${dimId}`) ?? "[]"));
  return coats[dimId];
}
const pk = (p) => `${p.x},${p.y},${p.z}`;
function isCoated(b) {
  return coatSet(b.dimension.id).has(pk(b.location));
}
function coat(b, on) {
  const s = coatSet(b.dimension.id);
  on ? s.add(pk(b.location)) : s.delete(pk(b.location));
  world.setDynamicProperty(coatKey(b), JSON.stringify([...s]));
}
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.itemStack?.typeId !== "nookworks:fireproof_coating") return;
  e.cancel = true;
  const { block, player } = e;
  system.run(() => {
    if (isCoated(block)) return actionbar(player, tr("item.nookworks.fireproof_coating.already"));
    coat(block, true);
    wear(player);
    block.dimension.playSound("random.brew", block.location, { volume: 0.4 });
  });
});
system.runInterval(
  safe(() => {
    for (const dim of DIMS()) {
      const s = coatSet(dim.id);
      for (const k of s) {
        const [x, y, z] = k.split(",").map(Number);
        const b = blockAt(dim, { x, y, z });
        if (!b) continue;
        if (b.isAir) {
          s.delete(k);
          continue;
        }
        for (const d of Object.values(DIRS)) {
          const n = blockAt(dim, add(b.location, d));
          if (n && (n.typeId === "minecraft:fire" || n.typeId === "minecraft:soul_fire")) n.setType("minecraft:air");
        }
      }
    }
  }, "fireproof"),
  10
);

// ---- Oil Can: marks a door, trapdoor or gate as oiled (our Dawnwood ones and Motors then make no sound)
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || e.itemStack?.typeId !== "nookworks:oil_can") return;
  e.cancel = true;
  const { block, player } = e;
  system.run(() => {
    const k = `oil|${block.dimension.id}|${pk(block.location)}`;
    if (world.getDynamicProperty(k)) return actionbar(player, tr("item.nookworks.oil_can.already"));
    world.setDynamicProperty(k, true);
    wear(player);
  });
});

// ---- Fine Shears: shear a sheep (leash kept), with a third of a chance of another wool
world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
  if (e.itemStack?.typeId !== "nookworks:wool_shears" || e.target.typeId !== "minecraft:sheep") return;
  const sheep = e.target;
  if (sheep.getComponent("minecraft:is_sheared") || sheep.getComponent("minecraft:is_baby")) return;
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    const color = COLORS[sheep.getComponent("minecraft:color")?.value ?? 0];
    const n = 1 + Math.floor(Math.random() * 3) + (Math.random() < 1 / 3 ? 1 : 0);
    sheep.dimension.spawnItem(new ItemStack(`minecraft:${color}_wool`, n), sheep.location);
    try {
      sheep.triggerEvent("minecraft:on_sheared");
    } catch {}
    sheep.dimension.playSound("mob.sheep.shear", sheep.location);
    wear(player);
  });
});

// ---- Nook Dowsing Rod: points to the nearest sulfur caves (where cinnabar is)
world.afterEvents.itemUse.subscribe(
  safe((e) => {
    if (e.itemStack.typeId !== "nookworks:nook_dowsing_rod") return;
    const p = e.source;
    p.sendMessage({ rawtext: [tr("message.nookworks.nook_dowsing_rod.searching")] });
    system.run(() => {
      let found;
      try {
        found = p.dimension.findClosestBiome?.(p.location, "minecraft:sulfur_caves", { boundingSize: { x: 6400, y: 64, z: 6400 } });
      } catch {}
      if (!found) return p.sendMessage({ rawtext: [tr("nookworks.bedrock.dowsing_nothing")] });
      const dx = found.x - p.location.x, dz = found.z - p.location.z;
      const dist = Math.round(Math.hypot(dx, dz));
      p.sendMessage({ rawtext: [dist < 16 ? tr("message.nookworks.nook_dowsing_rod.below", found.y) : tr("message.nookworks.nook_dowsing_rod.found", dist, found.y)] });
      const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
      p.teleport(p.location, { rotation: { x: p.getRotation().x, y: yaw } });
      wear(p);
    });
  }, "dowsing")
);

// ---- Rootbound: sneak-use an axe on a sapling to bind it (the Java enchantment); a felled tree is then planted
//      again with saplings from the inventory (one for a 1-wide trunk, four for a 2x2).
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const h = e.itemStack;
  if (!e.isFirstEvent || !e.player.isSneaking || !h?.hasTag("minecraft:is_axe") || !/_sapling$|propagule/.test(e.block.typeId)) return;
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    const s = held(player);
    if (!s) return;
    s.setDynamicProperty("rootbound", true);
    s.setLore(["§7Rootbound"]);
    setHeld(player, s);
    player.playSound("random.orb");
  });
});
setRootboundHook((player, item, dim, origin, logType) => {
  if (!item.getDynamicProperty?.("rootbound")) return;
  const wood = logType.replace("minecraft:", "").replace(/_(log|stem|wood)$/, "");
  const sapling = `minecraft:${wood}_sapling`;
  // the trunk's width: 2x2 when logs stood beside the origin
  const spots = [origin];
  const inv = player.getComponent("minecraft:inventory").container;
  const count = () => {
    let n = 0;
    for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === sapling) n += inv.getItem(i).amount;
    return n;
  };
  if (count() < spots.length) return;
  system.runTimeout(() => {
    for (const p of spots) {
      const b = blockAt(dim, p), soil = blockAt(dim, add(p, DIRS.down));
      if (!b?.isAir || !/dirt|grass|podzol|moss|mud/.test(soil?.typeId ?? "")) continue;
      for (let i = 0; i < inv.size; i++) {
        const s = inv.getItem(i);
        if (s?.typeId !== sapling) continue;
        try {
          b.setType(sapling);
        } catch {
          return;
        }
        if (!isCreative(player)) {
          if (s.amount > 1) {
            s.amount--;
            inv.setItem(i, s);
          } else inv.setItem(i, undefined);
        }
        break;
      }
    }
  }, 10);
});
