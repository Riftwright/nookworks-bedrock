// Rope, Thin Rope and Thin Chain (docs/java_spec.md §14).
// - Rope hangs from a ceiling and is climbed (Bedrock: jump to go up, sneak to hold, else slide down slowly).
// - Thin Rope / Thin Chain used on one post then another (within 16) strings a span between them (an entity drawn as
//   a straight line), 1 item per block. Hit a span to take it down.
// - Filament Bulbs and lanterns used on a span hang there and light it (an invisible light block); raw fish and kelp
//   hung there dry in the sun. An empty hand takes things down; sneak + empty hand switches the lights.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { onBlock } from "../lib/blocks.js";
import { DIRS, add, blockAt, held, setHeld, isCreative, give, tr, actionbar, safe, state, setStates, consumeHeld } from "../lib/util.js";
import { DATA } from "../generated/data.js";
import { dataMapLookup, bedrockId } from "../lib/ids.js";

// ---- Rope / Thin Rope hanging down
for (const name of ["rope", "thin_rope"]) {
  onBlock(name, {
    interact: ({ block, player }) => {
      const h = held(player);
      let bottom = block;
      while (blockAt(bottom.dimension, add(bottom.location, DIRS.down))?.typeId === block.typeId) bottom = blockAt(bottom.dimension, add(bottom.location, DIRS.down));
      if (h?.typeId === block.typeId) {
        const below = blockAt(block.dimension, add(bottom.location, DIRS.down));
        if (below?.isAir) {
          below.setType(block.typeId);
          consumeHeld(player);
          block.dimension.playSound("dig.cloth", below.location);
        }
      } else if (!h && bottom.location.y !== block.location.y) {
        bottom.setType("minecraft:air");
        if (!isCreative(player)) give(player, new ItemStack(block.typeId, 1));
      }
    },
    broken: ({ block, dim }) => {
      // what hung below it falls
      let p = add(block.location, DIRS.down);
      for (let i = 0; i < 256; i++) {
        const b = blockAt(dim, p);
        if (b?.typeId !== `nookworks:${name}`) break;
        dim.runCommand(`setblock ${p.x} ${p.y} ${p.z} air destroy`);
        p = add(p, DIRS.down);
      }
    },
  });
}
// climbing a Rope
system.runInterval(
  safe(() => {
    for (const p of world.getAllPlayers()) {
      const l = p.location;
      const b = blockAt(p.dimension, { x: Math.floor(l.x), y: Math.floor(l.y + 0.5), z: Math.floor(l.z) });
      if (b?.typeId !== "nookworks:rope") continue;
      if (p.isJumping) p.addEffect("levitation", 4, { amplifier: 2, showParticles: false });
      else p.addEffect("slow_falling", 6, { amplifier: 0, showParticles: false });
      if (p.isSneaking) p.addEffect("levitation", 3, { amplifier: 255, showParticles: false });
    }
  }, "rope climb"),
  2
);

// ---- spans
const POST = /fence|_wall$|iron_bars|lightning_rod|end_rod|nookworks:hook|_support$|chain$/;
const SPAN_ITEM = { "nookworks:thin_rope": "nookworks:rope_span", "nookworks:thin_chain": "nookworks:chain_span" };
const pending = new Map(); // player id -> {pos, dim, item, tick}

world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const s = e.itemStack;
  if (!e.isFirstEvent || !s || !SPAN_ITEM[s.typeId] || !POST.test(e.block.typeId)) return;
  e.cancel = true;
  const { player, block } = e;
  system.run(safe(() => tie(player, block, s.typeId), "tie"));
});

function tie(player, block, item) {
  const p = pending.get(player.id);
  const here = { x: block.location.x + 0.5, y: block.location.y + 0.75, z: block.location.z + 0.5 };
  if (!p || p.item !== item || system.currentTick - p.tick > 600 || p.dim !== block.dimension.id) {
    pending.set(player.id, { pos: here, dim: block.dimension.id, item, tick: system.currentTick });
    actionbar(player, tr("nookworks.bedrock.rope_started"));
    return;
  }
  pending.delete(player.id);
  const a = p.pos, b = here;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.5) return;
  if (len > 16) return actionbar(player, tr("nookworks.bedrock.rope_too_long"));
  const cost = Math.ceil(len);
  if (!isCreative(player) && !takeItems(player, item, cost)) return actionbar(player, tr("nookworks.bedrock.rope_needs", cost));
  const span = block.dimension.spawnEntity(SPAN_ITEM[item], a);
  span.setRotation({ x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI });
  span.setProperty("nookworks:length", len);
  span.setProperty("nookworks:pitch", (Math.asin(dy / len) * 180) / Math.PI); // Bedrock x rotation is the negated Java one: positive tilts +z upward
  span.setDynamicProperty("ends", JSON.stringify([a, b]));
  span.setDynamicProperty("cost", cost);
  span.setDynamicProperty("item", item);
  span.setDynamicProperty("hung", "[]");
  block.dimension.playSound("dig.cloth", b);
}

function takeItems(player, id, n) {
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

function pointAt(span, t) {
  const [a, b] = JSON.parse(span.getDynamicProperty("ends"));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 0.25, z: a.z + (b.z - a.z) * t };
}

// hanging things on a span, taking them down, switching lights
const LIGHTS = /filament_bulb|lantern/;
world.beforeEvents.playerInteractWithEntity.subscribe((e) => {
  const span = e.target;
  if (span.typeId !== "nookworks:rope_span" && span.typeId !== "nookworks:chain_span") return;
  if (span.getDynamicProperty("belt")) return;
  e.cancel = true;
  const player = e.player;
  const s = e.itemStack;
  system.run(
    safe(() => {
      const hung = JSON.parse(span.getDynamicProperty("hung") ?? "[]");
      const [a, b] = JSON.parse(span.getDynamicProperty("ends"));
      // the point on the span nearest where the player looks
      const eye = player.getHeadLocation(), v = player.getViewDirection();
      let best = 0.5, bd = 1e9;
      for (let i = 1; i < 20; i++) {
        const t = i / 20, q = pointAt(span, t);
        const w = { x: q.x - eye.x, y: q.y - eye.y, z: q.z - eye.z };
        const along = w.x * v.x + w.y * v.y + w.z * v.z;
        const d2 = w.x * w.x + w.y * w.y + w.z * w.z - along * along;
        if (d2 < bd) (bd = d2), (best = t);
      }
      if (s && (LIGHTS.test(s.typeId) || dataMapLookup(DATA.dataMaps["item/drying"], s.typeId))) {
        if (hung.some((h) => Math.abs(h.t - best) < 0.4 / Math.max(1, span.getProperty("nookworks:length")))) return;
        const h = { t: best, id: s.typeId, at: world.getAbsoluteTime(), lit: true };
        hung.push(h);
        consumeHeld(player);
        if (LIGHTS.test(s.typeId)) setLight(span.dimension, pointAt(span, best), true);
      } else if (!s && hung.length) {
        hung.sort((x, y) => Math.abs(x.t - best) - Math.abs(y.t - best));
        const h = hung[0];
        if (player.isSneaking && LIGHTS.test(h.id)) {
          h.lit = !h.lit;
          setLight(span.dimension, pointAt(span, h.t), h.lit);
        } else {
          hung.shift();
          give(player, new ItemStack(dried(h) ?? h.id, 1));
          if (LIGHTS.test(h.id)) setLight(span.dimension, pointAt(span, h.t), false);
        }
      }
      span.setDynamicProperty("hung", JSON.stringify(hung));
    }, "span use")
  );
});

function dried(h) {
  const v = dataMapLookup(DATA.dataMaps["item/drying"], h.id);
  if (!v) return null;
  return world.getAbsoluteTime() - h.at >= v.ticks ? bedrockId(v.result) : null;
}

function setLight(dim, p, on) {
  const b = blockAt(dim, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
  if (!b) return;
  if (on && b.isAir) b.setPermutation(BlockPermutation.resolve("minecraft:light_block_13"));
  else if (!on && b.typeId.startsWith("minecraft:light_block")) b.setType("minecraft:air");
}

world.afterEvents.entityHitEntity.subscribe(
  safe((e) => {
    const span = e.hitEntity;
    if (span.typeId !== "nookworks:rope_span" && span.typeId !== "nookworks:chain_span") return;
    if (span.getDynamicProperty("belt")) return; // a drive belt comes off at its wheel
    removeSpan(span, e.damagingEntity);
  }, "span hit")
);

function removeSpan(span, player) {
  const creative = player && isCreative(player);
  const hung = JSON.parse(span.getDynamicProperty("hung") ?? "[]");
  for (const h of hung) {
    if (!creative) span.dimension.spawnItem(new ItemStack(dried(h) ?? h.id, 1), pointAt(span, h.t));
    if (LIGHTS.test(h.id)) setLight(span.dimension, pointAt(span, h.t), false);
  }
  if (!creative) {
    let n = span.getDynamicProperty("cost") ?? 1;
    while (n > 0) {
      const k = Math.min(64, n);
      span.dimension.spawnItem(new ItemStack(span.getDynamicProperty("item"), k), span.location);
      n -= k;
    }
  }
  span.remove();
}

// a span whose post is gone comes down
system.runInterval(
  safe(() => {
    for (const dim of ["overworld", "nether", "the_end"].map((d) => world.getDimension(d)))
      for (const span of dim.getEntities({ families: ["nookworks_span"] })) {
        const ends = span.getDynamicProperty("ends");
        if (!ends) continue;
        for (const e of JSON.parse(ends)) {
          const b = blockAt(dim, { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) });
          if (b && !POST.test(b.typeId)) {
            removeSpan(span);
            break;
          }
        }
      }
  }, "span posts"),
  40
);
