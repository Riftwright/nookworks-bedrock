// Dawnwood (leaves, sapling, signs, boats), books and bookends, glazed flower pots, supports, corrugated sheets,
// hooks, chimney smoke, mirrors, and the Sort for vanilla chests (docs/java_spec.md §9, §12, §14).
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { onBlock, onAnyBreak, onItemTap } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { packItem, unpackItem, sameItem, maxStack } from "../lib/store.js";
import { DIRS, add, blockAt, held, setHeld, consumeHeld, isCreative, give, tr, actionbar, safe, setStates, state, chance } from "../lib/util.js";
import { containerOf } from "../lib/inv.js";
import { DATA } from "../generated/data.js";
import { dropLoot } from "./drops.js";

// ---- Dawnwood leaves decay away from logs; the sapling grows into a small dawnwood tree
const LOG = "nookworks:dawnwood_log", LEAVES = "nookworks:dawnwood_leaves";
onBlock("dawnwood_leaves", {
  randomTick: ({ block }) => {
    if (store.get(block)?.placed) return;
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++)
        for (let dz = -4; dz <= 4; dz++) if (blockAt(block.dimension, { x: block.location.x + dx, y: block.location.y + dy, z: block.location.z + dz })?.typeId === LOG) return;
    if (!dropLoot(block.dimension, block.location, block.typeId, block.permutation)) {
      const { x, y, z } = block.location;
      return void block.dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
    }
    block.setType("minecraft:air");
  },
  placedBy: ({ block }) => store.set(block, { placed: true }),
});
function growDawnwood(b) {
  const h = 5 + Math.floor(Math.random() * 2);
  const dim = b.dimension, o = b.location;
  for (let i = 1; i <= h; i++) {
    const t = blockAt(dim, { x: o.x, y: o.y + i, z: o.z });
    if (!t || !(t.isAir || t.typeId === LEAVES)) return false;
  }
  for (let dy = h - 2; dy <= h + 1; dy++) {
    const r = dy >= h ? 1 : 2;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && chance(0.5)) continue;
        const l = blockAt(dim, { x: o.x + dx, y: o.y + dy, z: o.z + dz });
        if (l?.isAir) l.setType(LEAVES);
      }
  }
  for (let i = 0; i < h; i++) blockAt(dim, { x: o.x, y: o.y + i, z: o.z }).setType(LOG);
  return true;
}
onBlock("dawnwood_sapling", {
  randomTick: ({ block }) => {
    let light = 15;
    try {
      light = block.dimension.getLightLevel?.(add(block.location, DIRS.up)) ?? 15;
    } catch {}
    if (light < 9 || !chance(3 / 7)) return;
    const d = store.get(block, () => ({ stage: 0 }));
    if (!d.stage) {
      d.stage = 1;
      store.save(block);
    } else growDawnwood(block);
  },
  interact: ({ block, player }) => {
    if (held(player)?.typeId !== "minecraft:bone_meal") return;
    consumeHeld(player);
    block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center());
    if (chance(0.45)) growDawnwood(block);
  },
});

// ---- Dawnwood signs: Bedrock custom blocks hold no text, so the words float in front of the sign (a name tag)
const SIGNS = ["dawnwood_sign", "dawnwood_wall_sign", "dawnwood_hanging_sign", "dawnwood_wall_hanging_sign"];
function textAt(block) {
  return block.dimension.getEntities({ type: "nookworks:text", location: block.center(), maxDistance: 0.8 })[0];
}
async function editSign(block, player) {
  const cur = (textAt(block)?.nameTag ?? "").split("\n");
  const f = new ModalFormData().title({ rawtext: [tr("block.nookworks.dawnwood_sign")] });
  for (let i = 0; i < 4; i++) f.textField(`${i + 1}`, "", { defaultValue: cur[i] ?? "" });
  const r = await f.show(player);
  if (r.canceled) return;
  const text = r.formValues.map(String).join("\n").replace(/\n+$/, "");
  let e = textAt(block);
  if (!text) return void e?.remove();
  if (!e) e = block.dimension.spawnEntity("nookworks:text", { x: block.location.x + 0.5, y: block.location.y + 0.3, z: block.location.z + 0.5 });
  e.nameTag = text;
}
onBlock(SIGNS, {
  placedBy: ({ block, player }) => system.run(() => editSign(block, player)),
  interact: ({ block, player }) => {
    if (!held(player)) system.run(() => editSign(block, player));
  },
  broken: ({ block }) => textAt(block)?.remove(),
});

// ---- Dawnwood boats: Bedrock boats can't take a new wood, so they set down a boat of the game's own
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const id = e.itemStack?.typeId;
  if (!e.isFirstEvent || (id !== "nookworks:dawnwood_boat" && id !== "nookworks:dawnwood_chest_boat")) return;
  e.cancel = true;
  const { player, block } = e;
  system.run(() => {
    const p = add(block.location, DIRS.up);
    block.dimension.spawnEntity(id.includes("chest") ? "minecraft:chest_boat" : "minecraft:boat", { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    consumeHeld(player);
  });
});

// ---- books laid on a block (sneak + a book on a top) and taken back with an empty hand
// written books keep their pages only in the stack itself, which these blocks can't hold
const BOOKS = new Set(["minecraft:book", "minecraft:enchanted_book"]);
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const s = e.itemStack;
  if (!e.isFirstEvent || !e.player.isSneaking || !s || !BOOKS.has(s.typeId) || e.blockFace !== "Up") return;
  if (e.block.typeId === "nookworks:bookend") return;
  const target = e.block.typeId === "nookworks:placed_books" ? e.block : blockAt(e.block.dimension, add(e.block.location, DIRS.up));
  if (!target || !(target.isAir || target.typeId === "nookworks:placed_books")) return;
  e.cancel = true;
  const player = e.player;
  system.run(() => {
    if (target.isAir) target.setType("nookworks:placed_books");
    const d = store.get(target, () => ({ books: [] }));
    if (d.books.length >= 3) return;
    d.books.push(packItem(held(player)));
    d.books[d.books.length - 1].n = 1;
    store.save(target);
    consumeHeld(player);
    target.dimension.playSound("block.chiseled_bookshelf.insert", target.location);
  });
});
for (const name of ["placed_books", "book_row"]) {
  onBlock(name, {
    interact: ({ block, player }) => {
      if (held(player)) return;
      const d = store.get(block, () => ({ books: [] }));
      const b = d.books.pop();
      if (b) give(player, unpackItem(b));
      if (!d.books.length) {
        store.remove(block);
        block.setType("minecraft:air");
      } else store.save(block);
    },
    broken: ({ block, dim }) => {
      for (const b of store.getKey(store.keyOf(block))?.books ?? []) dim.spawnItem(unpackItem(b), block.center());
    },
  });
}
// a Bookend stands books up: five a block, carrying on into book rows
onBlock("bookend", {
  interact: ({ block, player }) => {
    const d = store.get(block, () => ({ books: [] }));
    const h = held(player);
    if (h && BOOKS.has(h.typeId) && d.books.length < 5) {
      d.books.push({ ...packItem(h), n: 1 });
      consumeHeld(player);
    } else if (!h && d.books.length) give(player, unpackItem(d.books.pop()));
    store.save(block);
    if (d.books.length) actionbar(player, { rawtext: [{ text: `📚 ${d.books.length}/5` }] });
  },
  broken: ({ block, dim }) => {
    for (const b of store.getKey(store.keyOf(block))?.books ?? []) dim.spawnItem(unpackItem(b), block.center());
  },
});

// ---- the Standing Mirror stands two blocks high (a reflection is beyond Bedrock: the glass shines)
onBlock("standing_mirror", {
  placedBy: ({ block }) => {
    const up = blockAt(block.dimension, add(block.location, DIRS.up));
    setStates(block, { half: "lower" });
    if (up?.isAir) up.setPermutation(block.permutation.withState("nookworks:half", "upper"));
  },
  broken: ({ block, perm, dim }) => {
    const other = blockAt(dim, add(block.location, perm.getState("nookworks:half") === "lower" ? DIRS.up : DIRS.down));
    if (other?.typeId === "nookworks:standing_mirror") other.setType("minecraft:air");
  },
});

// ---- Glazed Flower Pot: a flower or sapling goes in, an empty hand takes it out
const POTTED = Object.keys(DATA.blockStates).filter((k) => k.startsWith("glazed_potted_")).map((k) => k.slice(14));
const plantItem = (p) => bedrockId({ dandelion: "minecraft:dandelion", azalea_bush: "minecraft:azalea", flowering_azalea_bush: "minecraft:flowering_azalea", dawnwood_sapling: "nookworks:dawnwood_sapling", poplar_sapling: "minecraft:poplar_sapling" }[p] ?? `minecraft:${p}`);
import { bedrockId } from "../lib/ids.js";
onBlock("glazed_flower_pot", {
  interact: ({ block, player }) => {
    const h = held(player);
    if (!h) return;
    const p = POTTED.find((x) => plantItem(x) === h.typeId || (x === "dandelion" && h.typeId === "minecraft:yellow_flower"));
    if (!p) return;
    block.setType(`nookworks:glazed_potted_${p}`);
    consumeHeld(player);
  },
});
onBlock(POTTED.map((p) => `glazed_potted_${p}`), {
  interact: ({ block, player }) => {
    if (held(player)) return;
    const p = block.typeId.slice("nookworks:glazed_potted_".length);
    try {
      give(player, new ItemStack(plantItem(p), 1));
    } catch {}
    block.setType("nookworks:glazed_flower_pot");
  },
});

// ---- Supports: an axe steps post -> beam -> bracket -> wall post
const SHAPES = ["post", "beam", "bracket", "wall_post"];
onItemTap(Object.keys(DATA.blockStates).filter((k) => k.endsWith("_support")), (s) => s.hasTag("minecraft:is_axe"));
onBlock(Object.keys(DATA.blockStates).filter((k) => k.endsWith("_support")), {
  interact: ({ block, player }) => {
    if (!held(player)?.hasTag("minecraft:is_axe")) return;
    const s = state(block, "shape");
    setStates(block, { shape: SHAPES[(SHAPES.indexOf(s) + 1) % 4] });
    block.dimension.playSound("use.wood", block.location);
  },
});

// ---- Corrugated sheets weather like copper; honeycomb waxes, an axe scrapes back, the wrench (sneak) centres
const AGES = ["", "exposed_", "weathered_", "oxidized_"];
const sheetKinds = (k) => /^(waxed_)?(exposed_|weathered_|oxidized_)?(corrugated_sheet|scrap_bale)$/.exec(k);
const SHEETS = Object.keys(DATA.blockStates).filter((k) => sheetKinds(k) || /^(red|green|blue|white)_corrugated_sheet$/.test(k));
onItemTap(SHEETS, (s, p) => s.typeId === "minecraft:honeycomb" || s.hasTag("minecraft:is_axe") || (s.typeId === "nookworks:wrench" && p.isSneaking));
function swapKeep(block, id) {
  const st = block.permutation.getAllStates();
  block.setType(id);
  for (const [k, v] of Object.entries(st)) {
    try {
      block.setPermutation(block.permutation.withState(k, v));
    } catch {}
  }
}
onBlock(SHEETS, {
  randomTick: ({ block }) => {
    const m = sheetKinds(block.typeId.slice(10));
    if (!m || m[1] || !chance(0.05)) return;
    const age = AGES.indexOf(m[2] ?? "");
    if (age < 3) swapKeep(block, `nookworks:${AGES[age + 1]}${m[3]}`);
  },
  interact: ({ block, player }) => {
    const m = sheetKinds(block.typeId.slice(10)) ?? [null, null, null, null];
    const h = held(player);
    if (!m[3] && h?.typeId !== "nookworks:wrench") return;
    if (h?.typeId === "minecraft:honeycomb" && !m[1]) {
      swapKeep(block, `nookworks:waxed_${m[2] ?? ""}${m[3]}`);
      consumeHeld(player);
    } else if (h?.hasTag("minecraft:is_axe")) {
      if (m[1]) swapKeep(block, `nookworks:${m[2] ?? ""}${m[3]}`);
      else if (m[2]) swapKeep(block, `nookworks:${AGES[AGES.indexOf(m[2]) - 1]}${m[3]}`);
    } else if (h?.typeId === "nookworks:wrench" && player.isSneaking) setStates(block, { centered: !state(block, "centered") });
  },
});

// ---- Hook: sweet berries or glow berries hang from it as a sprig; an empty hand takes them
onBlock("hook", {
  interact: ({ block, player }) => {
    const h = held(player);
    const sprig = state(block, "sprig");
    if (h && sprig === "none" && (h.typeId === "minecraft:sweet_berries" || h.typeId === "minecraft:glow_berries")) {
      setStates(block, { sprig: h.typeId.slice(10) });
      consumeHeld(player);
    } else if (!h && sprig !== "none") {
      give(player, new ItemStack(`minecraft:${sprig}`, 1));
      setStates(block, { sprig: "none" });
    }
  },
});

// ---- chimneys over a fire smoke
const FIRES = /^minecraft:(campfire|soul_campfire|lit_furnace|lit_smoker|lit_blast_furnace|fire)$/;
for (const c of ["chimney", "stone_brick_chimney", "nether_brick_chimney", "cobblestone_chimney"])
  onBlock(c, {
    tick: ({ block }) => {
      if (!state(block, "top")) return;
      let b = blockAt(block.dimension, add(block.location, DIRS.down)), i = 0;
      while (b && b.typeId.endsWith("chimney") && i++ < 32) b = blockAt(b.dimension, add(b.location, DIRS.down));
      const lit = b && (FIRES.test(b.typeId) && !(b.typeId.includes("campfire") && b.permutation.getState("extinguished")) || (b.typeId === "nookworks:generator" && state(b, "lit")));
      if (lit) block.dimension.spawnParticle("minecraft:campfire_tall_smoke_particle", { x: block.location.x + 0.5, y: block.location.y + 1.1, z: block.location.z + 0.5 });
    },
  });

// ---- Sort for vanilla chests, barrels and shulker boxes: sneak + empty hand; again within 2 s for the reverse
const lastSort = new Map();
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (!e.isFirstEvent || !e.player.isSneaking || e.itemStack) return;
  if (!/^minecraft:(chest|trapped_chest|barrel|.*shulker_box)$/.test(e.block.typeId)) return;
  e.cancel = true;
  const { block, player } = e;
  system.run(
    safe(() => {
      const c = containerOf(block);
      if (!c) return;
      const last = lastSort.get(player.id);
      const desc = last && last.key === `${block.location.x},${block.location.y},${block.location.z}` && system.currentTick - last.t < 40 && !last.desc;
      lastSort.set(player.id, { key: `${block.location.x},${block.location.y},${block.location.z}`, t: system.currentTick, desc });
      // the stacks themselves are moved (nothing rebuilt, so potions, books and boxes keep their data)
      const stacks = [];
      for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i);
        if (s) stacks.push(s);
      }
      const merged = [];
      for (const s of stacks) {
        let left = s.amount;
        for (const m of merged) {
          if (!left) break;
          if (m.isStackableWith(s) && m.amount < m.maxAmount) {
            const k = Math.min(left, m.maxAmount - m.amount);
            m.amount += k;
            left -= k;
          }
        }
        if (left) {
          s.amount = left;
          merged.push(s);
        }
      }
      const key = (x) => x.typeId.replace(/^minecraft:/, "~");
      merged.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : b.amount - a.amount));
      if (desc) merged.reverse();
      for (let i = 0; i < c.size; i++) c.setItem(i, merged[i]);
      player.playSound("random.click");
      actionbar(player, tr(desc ? "nookworks.bedrock.sort_desc" : "nookworks.bedrock.sort"));
    }, "chest sort")
  );
});
