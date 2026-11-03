// Storage Barrels (docs/java_spec.md §9): slots × stacks-per-slot, a form for taking and putting in, sorting,
// in-place upgrades. Contents spill when broken (refused by hand over 256 stacks, as Java's guard).
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { onBlock } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { packItem, unpackItem, sameItem, maxStack, packable } from "../lib/store.js";
import { acceptors, containerOf, dropSlots } from "../lib/inv.js";
import { itemText } from "../lib/machine.js";
import { registerInv, entityOf, readSlots, writeSlots, removeQuietly, containerOfBlock } from "../lib/invent.js";
import { DIRS, add, blockAt, held, setHeld, give, tr, isCreative, setStates, state, safe, consumeHeld } from "../lib/util.js";

export const TIERS = { iron: [27, 2], gold: [54, 4], diamond: [81, 16], netherite: [108, 256], velarium: [135, 1024] };
const ORDER = ["iron", "gold", "diamond", "netherite", "velarium"];
const tierOf = (typeId) => typeId.slice(10).replace("_storage_barrel", "");
const NOT_INSIDE = /shulker_box|bundle$/;

function data(block) {
  return store.get(block, () => ({ items: [], sortDesc: false }));
}
function slotCap(tier, id) {
  return TIERS[tier][1] * maxStack(id);
}
/** Puts a packed item in; returns what was left. */
export function insert(block, d, p) {
  if (NOT_INSIDE.test(p.id) || !packable({ typeId: p.id })) return p.n;
  const tier = tierOf(block.typeId);
  const [slots] = TIERS[tier];
  let left = p.n;
  for (const e of d.items) {
    if (!sameItem(e, p)) continue;
    const k = Math.min(left, slotCap(tier, p.id) - e.n);
    if (k > 0) {
      e.n += k;
      left -= k;
    }
    if (!left) break;
  }
  while (left > 0 && d.items.length < slots) {
    const k = Math.min(left, slotCap(tier, p.id));
    d.items.push({ ...p, n: k });
    left -= k;
  }
  store.save(block);
  return left;
}
function take(block, d, idx, n) {
  const e = d.items[idx];
  if (!e) return;
  const k = Math.min(n, e.n);
  e.n -= k;
  if (e.n <= 0) d.items.splice(idx, 1);
  store.save(block);
  return { ...e, n: k };
}
function giveMany(player, p) {
  let left = p.n;
  while (left > 0) {
    const s = unpackItem({ ...p, n: left });
    if (!s) return;
    left -= s.amount;
    give(player, s);
  }
}
function sortItems(d) {
  const key = (e) => e.id.replace(/^minecraft:/, "~");
  d.items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : b.n - a.n));
  if (d.sortDesc) d.items.reverse();
  // merge partial slots of the same item
  const out = [];
  for (const e of d.items) {
    const last = out[out.length - 1];
    if (last && sameItem(last, e)) last.n += e.n;
    else out.push({ ...e });
  }
  d.items = out;
}
const stacks = (d) => d.items.reduce((s, e) => s + Math.ceil(e.n / maxStack(e.id)), 0);

const BARRELS = ORDER.map((t) => `${t}_storage_barrel`);
for (const b of BARRELS) acceptors.set(`nookworks:${b}`, (block, p) => insert(block, data(block), p));

onBlock(BARRELS, {
  interact: ({ block, player }) => {
    const h = held(player);
    // an upgrade used on it goes up one tier in place
    if (h?.typeId.endsWith("_storage_upgrade")) return upgrade(block, player, h);
    open(block, player, 0);
  },
  beforeBreak: ({ block, player }) => {
    const d = store.getKey(store.keyOf(block));
    if (d && d.items && stacks(d) > 256 && !isCreative(player)) {
      system.run(() => player.sendMessage({ rawtext: [tr("message.nookworks.storage.too_full")] }));
      return true;
    }
  },
  broken: ({ block, dim }) => {
    const d = store.getKey(store.keyOf(block));
    if (d) dropSlots(dim ?? block.dimension, block.location, d.items);
  },
  tick: ({ block }) => {
    // a hopper underneath draws from it, as from a vanilla barrel
    const d = store.get(block);
    if (!d?.items.length) return;
    const below = blockAt(block.dimension, add(block.location, DIRS.down));
    if (below?.typeId !== "minecraft:hopper") return;
    const c = containerOf(below);
    const e = d.items[d.items.length - 1];
    const s = unpackItem({ ...e, n: 1 });
    if (c && s && !c.addItem(s)) take(block, d, d.items.length - 1, 1);
  },
});

function upgrade(block, player, h) {
  const to = h.typeId.slice(10).replace("_storage_upgrade", "");
  const from = tierOf(block.typeId);
  if (ORDER.indexOf(to) !== ORDER.indexOf(from) + 1) {
    player.sendMessage({ rawtext: [tr("message.nookworks.storage_upgrade.wrong_tier")] });
    return;
  }
  const d = data(block);
  const perm = block.permutation;
  block.setType(`nookworks:${to}_storage_barrel`);
  try {
    block.setPermutation(block.permutation.withState("minecraft:facing_direction", perm.getState("minecraft:facing_direction")));
  } catch {}
  store.set(block, d);
  consumeHeld(player);
  block.dimension.playSound("random.anvil_use", block.location);
}

const PAGE = 24;
async function open(block, player, page) {
  const d = data(block);
  const tier = tierOf(block.typeId);
  const [slots, mult] = TIERS[tier];
  const f = new ActionFormData().title({ rawtext: [{ translate: `block.nookworks.${tier}_storage_barrel` }] });
  const pages = Math.max(1, Math.ceil(d.items.length / PAGE));
  page = Math.min(page, pages - 1);
  f.body({ rawtext: [{ text: `${d.items.length} / ${slots} (×${mult})   ` }, tr("nookworks.bedrock.page", page + 1, pages)] });
  const acts = [];
  const h = held(player);
  if (h) {
    f.button({ rawtext: [tr("nookworks.bedrock.deposit_all"), { text: "\n" }, itemText(h.typeId)] });
    acts.push(() => depositAllOf(block, d, player, h.typeId));
  }
  f.button({ rawtext: [tr("nookworks.bedrock.deposit_inventory")] });
  acts.push(() => depositInventory(block, d, player));
  for (let i = page * PAGE; i < Math.min(d.items.length, (page + 1) * PAGE); i++) {
    const e = d.items[i];
    f.button({ rawtext: [itemText(e.id), { text: ` §8x${e.n}` }] });
    acts.push(() => takeForm(block, d, player, i));
  }
  if (page + 1 < pages) {
    f.button({ rawtext: [tr("nookworks.bedrock.next")] });
    acts.push(() => open(block, player, page + 1));
  }
  if (page > 0) {
    f.button({ rawtext: [tr("nookworks.bedrock.prev")] });
    acts.push(() => open(block, player, page - 1));
  }
  f.button({ rawtext: [tr(d.sortDesc ? "nookworks.bedrock.sort_desc" : "nookworks.bedrock.sort")] });
  acts.push(() => {
    sortItems(d);
    store.save(block);
    open(block, player, 0);
  });
  f.button({ rawtext: [{ text: "⇅ " }, tr(d.sortDesc ? "nookworks.bedrock.sort" : "nookworks.bedrock.sort_desc")] });
  acts.push(() => {
    d.sortDesc = !d.sortDesc;
    sortItems(d);
    store.save(block);
    open(block, player, 0);
  });
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  if (!block.isValid || store.get(block) !== d) return;
  safe(acts[r.selection], "barrel form")();
}

async function takeForm(block, d, player, i) {
  const e = d.items[i];
  if (!e) return;
  const ms = maxStack(e.id);
  const f = new ActionFormData().title({ rawtext: [itemText(e.id)] }).body(`x${e.n}`);
  const opts = [1, Math.min(ms, e.n), Math.min(ms * 4, e.n), e.n].filter((v, k, a) => v > 0 && a.indexOf(v) === k);
  for (const n of opts) f.button(`${n}`);
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  const n = opts[r.selection];
  if (!block.isValid || store.get(block) !== d) return; // broken while the form was open
  const got = take(block, d, i, n);
  if (got) giveMany(player, got);
  open(block, player, Math.floor(i / PAGE));
}

function depositAllOf(block, d, player, typeId) {
  const inv = player.getComponent("minecraft:inventory").container;
  for (let i = 0; i < inv.size; i++) {
    const s = inv.getItem(i);
    if (!s || s.typeId !== typeId) continue;
    const left = insert(block, d, packItem(s));
    if (left === s.amount) break;
    if (left) {
      s.amount = left;
      inv.setItem(i, s);
    } else inv.setItem(i, undefined);
  }
}

function depositInventory(block, d, player) {
  const inv = player.getComponent("minecraft:inventory").container;
  // the hotbar stays: what is in the hand is for using
  for (let i = 9; i < inv.size; i++) {
    const s = inv.getItem(i);
    if (!s) continue;
    const left = insert(block, d, packItem(s));
    if (left === s.amount) continue;
    if (left) {
      s.amount = left;
      inv.setItem(i, s);
    } else inv.setItem(i, undefined);
  }
}

// ---- Crate: 9 slots in its own screen; keeps what it holds in its item (stack 1)
const CRATE = "nookworks:crate";
registerInv("crate", { size: 9 });
onBlock("crate", {
  place: ({ block }) => entityOf(block),
  broken: ({ block, dim, player }) => {
    const c = containerOfBlock(block, false);
    const slots = [];
    for (let i = 0; c && i < 9; i++) {
      const s = c.getItem(i);
      if (s && !packable(s)) {
        (dim ?? block.dimension).spawnItem(s, block.center());
        slots.push(null);
      } else slots.push(s ? packItem(s) : null);
    }
    removeQuietly(block);
    if (player && isCreative(player) && !slots.some((x) => x)) return;
    const s = new ItemStack(CRATE, 1);
    if (slots.some((x) => x)) {
      s.setDynamicProperty("contents", JSON.stringify(slots));
      s.setLore([`§7${slots.filter((x) => x).length} / 9`]);
    }
    (dim ?? block.dimension).spawnItem(s, block.center());
  },
});
// a crate carrying contents: put them back in when it is placed
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  if (e.itemStack?.typeId !== CRATE || !e.isFirstEvent) return;
  const raw = e.itemStack.getDynamicProperty("contents");
  if (!raw) return;
  const off = { Up: DIRS.up, Down: DIRS.down, North: DIRS.north, South: DIRS.south, East: DIRS.east, West: DIRS.west }[e.blockFace];
  const pos = add(e.block.location, off);
  const dim = e.block.dimension;
  system.run(() => {
    for (const p of [pos, e.block.location]) {
      const b = blockAt(dim, p);
      if (b?.typeId === CRATE) return void writeSlots(b, JSON.parse(raw));
    }
  });
});

/** A small chest-like form over d.slots (crate, magnet chest, ...). */
export async function slotsForm(block, player, size, titleKey, allow) {
  const d = store.get(block, () => ({ slots: new Array(size).fill(null) }));
  d.slots ??= new Array(size).fill(null);
  const f = new ActionFormData().title({ rawtext: [{ translate: titleKey }] });
  const acts = [];
  const h = held(player);
  if (h && (!allow || allow(packItem(h)))) {
    f.button({ rawtext: [tr("nookworks.bedrock.put_in"), { text: " " }, itemText(h.typeId)] });
    acts.push(() => {
      const p = packItem(h);
      let left = p.n;
      for (let i = 0; i < size && left; i++) {
        const s = d.slots[i];
        if (!s) {
          d.slots[i] = { ...p, n: left };
          left = 0;
        } else if (sameItem(s, p)) {
          const k = Math.min(left, maxStack(p.id) - s.n);
          s.n += k;
          left -= k;
        }
      }
      if (!isCreative(player)) {
        if (left) {
          h.amount = left;
          setHeld(player, h);
        } else setHeld(player, undefined);
      }
    });
  }
  d.slots.forEach((s, i) => {
    if (!s) return;
    f.button({ rawtext: [itemText(s.id), { text: ` §8x${s.n}` }] });
    acts.push(() => {
      giveMany(player, s);
      d.slots[i] = null;
    });
  });
  if (d.slots.some((s) => s)) {
    f.button({ rawtext: [tr("nookworks.bedrock.take_all")] });
    acts.push(() => {
      d.slots.forEach((s, i) => {
        if (s) giveMany(player, s);
        d.slots[i] = null;
      });
    });
  }
  f.button({ rawtext: [tr("gui.done")] });
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined || !acts[r.selection]) return;
  acts[r.selection]();
  store.save(block);
}
