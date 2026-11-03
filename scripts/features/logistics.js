// Magnet Chest, Trash Can, Item Warps, Elevators, Item/Precision Sorters (docs/java_spec.md §9).
import { redstoneIn } from "../lib/blocks.js";
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { onBlock } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { packItem, unpackItem, sameItem, maxStack, packable } from "../lib/store.js";
import { acceptors, containerOf, deliverBelow, pullFromHoppers, pushInto, dropSlots } from "../lib/inv.js";
import { DIRS, OPPOSITE, add, blockAt, held, setHeld, tr, state, setStates, safe, facing, isCreative, center, isSolidBlock } from "../lib/util.js";
import { registerInv, entityOf, containerOfBlock, dropAndRemove } from "../lib/invent.js";
import { itemText } from "../lib/machine.js";
import { setting } from "./settings.js";

function addToSlots(d, size, p) {
  d.slots ??= new Array(size).fill(null);
  let left = p.n;
  for (let i = 0; i < size && left; i++) {
    const s = d.slots[i];
    if (s && sameItem(s, p)) {
      const k = Math.min(left, maxStack(p.id) - s.n);
      s.n += k;
      left -= k;
    }
  }
  for (let i = 0; i < size && left; i++) {
    if (!d.slots[i]) {
      d.slots[i] = { ...p, n: Math.min(left, maxStack(p.id)) };
      left -= d.slots[i].n;
    }
  }
  return left;
}

// ---- Magnet Chest: 27 slots in its own screen, pulls dropped items within 5 blocks; a hopper under it empties it
registerInv("magnet_chest", { size: 27 });
onBlock("magnet_chest", {
  place: ({ block }) => entityOf(block),
  broken: ({ block, dim }) => dropAndRemove(block, dim),
  tick: ({ block }) => {
    const c = containerOfBlock(block);
    if (!c) return;
    for (const it of block.dimension.getEntities({ type: "minecraft:item", location: block.center(), maxDistance: 5 })) {
      const s = it.getComponent("minecraft:item")?.itemStack;
      if (!s) continue;
      const rest = c.addItem(s);
      if (rest && rest.amount === s.amount) continue;
      if (rest) it.dimension.spawnItem(rest, it.location);
      it.remove();
    }
    const below = blockAt(block.dimension, add(block.location, DIRS.down));
    const hc = below?.typeId === "minecraft:hopper" && containerOf(below);
    if (hc) {
      for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i);
        if (!s) continue;
        const one = s.clone();
        one.amount = 1;
        if (!hc.addItem(one)) {
          if (s.amount > 1) {
            s.amount--;
            c.setItem(i, s);
          } else c.setItem(i, undefined);
        }
        break;
      }
    }
  },
});
acceptors.set("nookworks:magnet_chest", (block, p) => {
  const c = containerOfBlock(block);
  if (!c) return p.n;
  return pushInto(c, p);
});

// ---- Trash Can: takes from hoppers only while powered (Bedrock: while a redstone signal reaches it)
onBlock("trash_can", {
  tick: ({ block }) => {
    const powered = redstoneIn(block) > 0;
    setStates(block, { powered });
    if (!powered) return;
    const d = store.get(block, () => ({ destroyed: 0 }));
    pullFromHoppers(block, (p) => {
      d.destroyed += p.n;
      store.save(block);
      return p.n;
    }, 64);
  },
  interact: ({ block, player }) => {
    const d = store.get(block, () => ({ destroyed: 0 }));
    player.onScreenDisplay.setActionBar({ rawtext: [tr("nookworks.bedrock.destroyed", d.destroyed)] });
  },
});

// ---- Item Warps: a sender sends to the nearest receiver straight up or down (or ahead, horizontal ones)
function findReceiver(block, horizontal) {
  const range = setting("itemWarpRange");
  const want = horizontal ? "nookworks:horizontal_item_warp_receiver" : "nookworks:item_warp_receiver";
  const dirs = horizontal ? [DIRS[facing(block)]] : [DIRS.up, DIRS.down];
  let best = null;
  for (let i = 1; i <= range && !best; i++)
    for (const d of dirs) {
      const b = blockAt(block.dimension, add(block.location, d, i));
      if (b?.typeId === want) {
        best = b;
        break;
      }
    }
  return best;
}
function receiverOut(r, p) {
  if (r.typeId.includes("horizontal")) return deliverBelow(r, p, { dir: facing(r) });
  return deliverBelow(r, p);
}
function senderTick(horizontal) {
  return ({ block }) => {
    const d = store.get(block, () => ({ slot: null }));
    // dropped on top or hoppered in
    if (!d.slot) {
      const top = { x: block.location.x + 0.5, y: block.location.y + 1.2, z: block.location.z + 0.5 };
      for (const it of block.dimension.getEntities({ type: "minecraft:item", location: top, maxDistance: 0.9 })) {
        const s = it.getComponent("minecraft:item")?.itemStack;
        if (!s || !packable(s)) continue;
        d.slot = packItem(s);
        it.remove();
        break;
      }
    }
    if (!d.slot) pullFromHoppers(block, (p) => ((d.slot = p), p.n), 64);
    if (d.slot) {
      const r = findReceiver(block, horizontal);
      if (r) {
        const left = receiverOut(r, d.slot);
        d.slot = left > 0 ? { ...d.slot, n: left } : null;
      }
    }
    store.save(block);
  };
}
onBlock("item_warp_sender", { tick: senderTick(false), broken: ({ block, dim }) => dropSlots(dim, block.location, [store.getKey(store.keyOf(block))?.slot].filter(Boolean)) });
onBlock("horizontal_item_warp_sender", { tick: senderTick(true), broken: ({ block, dim }) => dropSlots(dim, block.location, [store.getKey(store.keyOf(block))?.slot].filter(Boolean)) });
for (const s of ["item_warp_sender", "horizontal_item_warp_sender"])
  acceptors.set(`nookworks:${s}`, (block, p) => {
    const d = store.get(block, () => ({ slot: null }));
    if (d.slot) return p.n;
    d.slot = p;
    store.save(block);
    return 0;
  });

// ---- Elevators: jump on one to go to the next above, sneak to go down (2 blocks of room needed)
const lastY = new Map();
const cooldown = new Map();
system.runInterval(
  safe(() => {
    for (const pl of world.getAllPlayers()) {
      const loc = pl.location;
      const under = blockAt(pl.dimension, { x: Math.floor(loc.x), y: Math.floor(loc.y - 0.2), z: Math.floor(loc.z) });
      const prev = lastY.get(pl.id) ?? loc.y;
      lastY.set(pl.id, loc.y);
      if ((cooldown.get(pl.id) ?? 0) > system.currentTick) continue;
      const onIt = under?.typeId === "nookworks:elevator";
      const base = onIt ? under : blockAt(pl.dimension, { x: Math.floor(loc.x), y: Math.floor(loc.y - 1.2), z: Math.floor(loc.z) });
      if (base?.typeId !== "nookworks:elevator") continue;
      const jumping = !pl.isOnGround && pl.getVelocity().y > 0.2 && loc.y > prev;
      const sneaking = pl.isSneaking && onIt;
      if (!jumping && !sneaking) continue;
      const dir = jumping ? 1 : -1;
      for (let i = 2; i <= setting("elevatorRange"); i++) {
        const b = blockAt(pl.dimension, add(base.location, DIRS.up, dir * i));
        if (b?.typeId !== "nookworks:elevator") continue;
        const a1 = blockAt(pl.dimension, add(b.location, DIRS.up));
        const a2 = blockAt(pl.dimension, add(b.location, DIRS.up, 2));
        if (!a1 || !a2 || isSolidBlock(a1) || isSolidBlock(a2) || /lava|fire/.test(a1.typeId + a2.typeId)) continue;
        pl.teleport({ x: loc.x, y: b.location.y + 1, z: loc.z }, { keepVelocity: false });
        pl.dimension.playSound("mob.endermen.portal", b.location, { volume: 0.4, pitch: 1.4 });
        cooldown.set(pl.id, system.currentTick + 8);
        break;
      }
    }
  }, "elevators"),
  2
);

// ---- Sorters: matches leave by the right-hand outlet seen from the front, the rest by the left
const GEAR_RATE = { none: [8, 1], gold: [4, 1], diamond: [2, 1], netherite: [1, 4], velarium: [1, 64] };
const RIGHT = { north: "west", south: "east", east: "north", west: "south" };
const SORTERS = ["item_sorter", "precision_sorter"];
for (const s of SORTERS) {
  const size = s === "item_sorter" ? 9 : 18;
  onBlock(s, {
    interact: ({ block, player }) => sorterForm(block, player, size),
    broken: ({ block, dim }) => {
      const d = store.getKey(store.keyOf(block));
      if (d?.gear) dropSlots(dim, block.location, [{ id: `nookworks:${d.gear}_sorter_gear`, n: 1 }]);
      if (d?.held) dropSlots(dim, block.location, [d.held]);
    },
    tick: ({ block }) => sorterTick(block),
  });
}
function sorterData(block) {
  return store.get(block, () => ({ filter: [], keepOut: [], keepOnly: false, exclude: false, gear: null, held: null, t: 0 }));
}
function sorterTick(block) {
  const d = sorterData(block);
  const [every, per] = GEAR_RATE[d.gear ?? "none"];
  d.t = (d.t ?? 0) + 10;
  if (d.t < every) return;
  const batches = Math.floor(d.t / every);
  d.t = 0;
  const f = facing(block);
  for (let b = 0; b < batches; b++) {
    if (!d.held) {
      // draws from the container above, like a hopper
      const above = blockAt(block.dimension, add(block.location, DIRS.up));
      const c = containerOf(above);
      if (c) {
        for (let i = 0; i < c.size; i++) {
          const s = c.getItem(i);
          if (!s || !packable(s)) continue;
          const listed = d.keepOut.includes(s.typeId);
          if (d.keepOnly ? !listed : listed) continue;
          const k = Math.min(per, s.amount);
          d.held = { ...packItem(s), n: k };
          if (s.amount > k) {
            s.amount -= k;
            c.setItem(i, s);
          } else c.setItem(i, undefined);
          break;
        }
      }
    }
    if (!d.held) break;
    const match = d.filter.includes(d.held.id) !== !!d.exclude;
    let out = match ? RIGHT[f] : OPPOSITE[RIGHT[f]];
    if (state(block, "swapped")) out = OPPOSITE[out];
    const left = deliverBelow(block, d.held, { dir: out, onlyDir: true });
    d.held = left > 0 ? { ...d.held, n: left } : null;
    if (d.held) break;
  }
  store.save(block);
}
acceptors.set("nookworks:item_sorter", (block, p) => sorterAccept(block, p));
acceptors.set("nookworks:precision_sorter", (block, p) => sorterAccept(block, p));
function sorterAccept(block, p) {
  const d = sorterData(block);
  if (d.held) return p.n;
  d.held = p;
  store.save(block);
  return 0;
}

async function sorterForm(block, player, size) {
  const d = sorterData(block);
  const h = held(player);
  if (h?.typeId.endsWith("_sorter_gear")) {
    const g = h.typeId.slice(10).replace("_sorter_gear", "");
    if (d.gear) dropSlots(block.dimension, add(block.location, DIRS.up), [{ id: `nookworks:${d.gear}_sorter_gear`, n: 1 }]);
    d.gear = g;
    setStates(block, { gear: g });
    if (!isCreative(player)) setHeld(player, h.amount > 1 ? ((h.amount -= 1), h) : undefined);
    store.save(block);
    return;
  }
  const f = new ActionFormData().title({ rawtext: [{ translate: `block.nookworks.${block.typeId.slice(10)}` }] });
  f.body({ rawtext: [tr("nookworks.bedrock.sorter_help"), { text: `\n§7${d.filter.length}/${size}` }] });
  const acts = [];
  if (h && d.filter.length < size && !d.filter.includes(h.typeId)) {
    f.button({ rawtext: [{ text: "+ " }, itemText(h.typeId)] });
    acts.push(() => d.filter.push(h.typeId));
  }
  if (h && !d.keepOut.includes(h.typeId) && d.keepOut.length < 8) {
    f.button({ rawtext: [tr(d.keepOnly ? "nookworks.bedrock.sorter_only_add" : "nookworks.bedrock.sorter_keepout_add"), { text: " " }, itemText(h.typeId)] });
    acts.push(() => d.keepOut.push(h.typeId));
  }
  d.filter.forEach((id, i) => {
    f.button({ rawtext: [{ text: "§c- " }, itemText(id)] });
    acts.push(() => d.filter.splice(i, 1));
  });
  d.keepOut.forEach((id, i) => {
    f.button({ rawtext: [{ text: "§6- " }, tr(d.keepOnly ? "nookworks.bedrock.sorter_only" : "nookworks.bedrock.sorter_keepout"), { text: " " }, itemText(id)] });
    acts.push(() => d.keepOut.splice(i, 1));
  });
  f.button({ rawtext: [tr(d.keepOnly ? "nookworks.bedrock.sorter_only" : "nookworks.bedrock.sorter_keepout"), { text: " ⇄" }] });
  acts.push(() => (d.keepOnly = !d.keepOnly));
  if (block.typeId === "nookworks:precision_sorter") {
    f.button({ rawtext: [tr(d.exclude ? "nookworks.bedrock.sorter_exclude" : "nookworks.bedrock.sorter_include"), { text: " ⇄" }] });
    acts.push(() => (d.exclude = !d.exclude));
  }
  f.button({ rawtext: [tr("nookworks.bedrock.sorter_swap")] });
  acts.push(() => setStates(block, { swapped: !state(block, "swapped") }));
  f.button({ rawtext: [tr("gui.done")] });
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined || !acts[r.selection]) return;
  acts[r.selection]();
  store.save(block);
}
