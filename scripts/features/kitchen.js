// Kitchen (docs/java_spec.md §6): Iron Pot, Grill, Nukadoko, Wooden Tray, Plate, and the hand machines worked by a
// handle (empty-hand click = one turn, or a Motor).
import { world, system, ItemStack } from "@minecraft/server";
import { onBlock, TICK } from "../lib/blocks.js";
import { defineMachine, putOut, spaceFor, fits } from "../lib/machine.js";
import * as store from "../lib/store.js";
import { packItem, unpackItem, sameItem } from "../lib/store.js";
import { dropSlots, takeFromSlot, deliverBelow, acceptors } from "../lib/inv.js";
import { DIRS, add, blockAt, held, setHeld, give, consumeHeld, isCreative, state, setStates, tr, actionbar, facing, safe } from "../lib/util.js";
import { DATA } from "../generated/data.js";
import { matches, dataMapLookup, bedrockId } from "../lib/ids.js";
import { FILLED, filledOf, fill, drain, pushFluid } from "../lib/fluids.js";
import { itemText } from "../lib/machine.js";

const dm = (n) => DATA.dataMaps[`item/${n}`];
const POT_RECIPES = Object.entries(DATA.machineRecipes).filter(([k]) => k.startsWith("pot_")).map(([, r]) => r);
const HEATS = /^minecraft:(fire|soul_fire|magma|lava|lit_furnace|lit_smoker|lit_blast_furnace|campfire|soul_campfire)$/;

function heated(block) {
  const b = blockAt(block.dimension, add(block.location, DIRS.down));
  if (!b) return false;
  if (b.typeId === "minecraft:campfire" || b.typeId === "minecraft:soul_campfire") {
    try {
      return !b.permutation.getState("extinguished");
    } catch {
      return true;
    }
  }
  if (HEATS.test(b.typeId)) return true;
  if (b.typeId === "nookworks:generator") return !!state(b, "lit");
  if (b.typeId === "nookworks:grill" || b.typeId === "minecraft:hopper") return heated(b);
  return false;
}

// ---- Iron Pot
function potData(block) {
  return store.get(block, () => ({ items: [], liquid: null, mb: 0, dish: null, cook: 0, settle: 0 }));
}
function potRecipe(d) {
  for (const r of POT_RECIPES) {
    if (r.liquid !== d.liquid || d.mb < r.amount) continue;
    const need = r.ingredients.map((i) => ({ ing: i.ingredient, n: i.count ?? 1 }));
    const have = d.items.map((p) => ({ ...p }));
    let ok = true;
    for (const nd of need) {
      let left = nd.n;
      for (const h of have) {
        if (left && h.n > 0 && matches(nd.ing, h.id)) {
          const k = Math.min(left, h.n);
          h.n -= k;
          left -= k;
        }
      }
      if (left) ok = false;
    }
    if (ok && have.every((h) => h.n === 0)) return r;
  }
  return null;
}
function acceptsIngredient(d, id) {
  return POT_RECIPES.some((r) => r.ingredients.some((i) => matches(i.ingredient, id)));
}

onBlock("iron_pot", {
  interact: ({ block, player }) => {
    const d = potData(block);
    const h = held(player);
    // liquids
    const f = h && FILLED[h.typeId];
    if (f && (f[0] === "water" || f[0] === "vegetable_oil")) {
      const liq = f[0] === "water" ? "water" : "oil";
      if ((d.liquid && d.liquid !== liq) || d.mb + f[1] > 1000) return actionbar(player, tr("nookworks.bedrock.not_accepted"));
      d.liquid = liq;
      d.mb += f[1];
      if (!isCreative(player)) {
        if (h.amount > 1) {
          h.amount--;
          setHeld(player, h);
          give(player, new ItemStack(f[2], 1));
        } else setHeld(player, new ItemStack(f[2], 1));
      }
      setStates(block, { liquid: liq });
      d.settle = 40;
      store.save(block);
      return;
    }
    if (h && (h.typeId === "minecraft:bucket" || h.typeId === "minecraft:glass_bottle") && d.liquid && !d.dish) {
      const got = filledOf(h.typeId, d.liquid === "oil" ? "vegetable_oil" : "water");
      if (got && d.mb >= got[1]) {
        d.mb -= got[1];
        if (!d.mb) d.liquid = null;
        consumeHeld(player);
        give(player, new ItemStack(got[0], 1));
        setStates(block, { liquid: d.liquid ?? "empty" });
        store.save(block);
        return;
      }
    }
    // a ready dish: an empty hand (or a bowl) takes a serving
    if (d.dish) {
      const needs = d.dish.container;
      if (needs && h?.typeId !== needs) {
        if (!h && !player.isSneaking) actionbar(player, { rawtext: [tr("nookworks.bedrock.pot_needs"), { text: " " }, itemText(needs)] });
        return;
      }
      if (needs) consumeHeld(player);
      give(player, new ItemStack(d.dish.id, 1));
      d.dish.n--;
      if (d.dish.n <= 0) d.dish = null;
      store.save(block);
      return;
    }
    if (h && !player.isSneaking && acceptsIngredient(d, h.typeId) && d.items.reduce((s, p) => s + p.n, 0) < 8 * 64) {
      const p = packItem(h);
      p.n = 1;
      const e = d.items.find((x) => sameItem(x, p));
      if (e) e.n++;
      else if (d.items.length < 8) d.items.push(p);
      else return;
      consumeHeld(player);
      if (h.typeId === "minecraft:milk_bucket") give(player, new ItemStack("minecraft:bucket", 1));
      d.settle = 40;
      d.cook = 0;
      store.save(block);
      return;
    }
    if (!h && player.isSneaking && d.items.length) {
      give(player, unpackItem(d.items.pop()));
      d.cook = 0;
      store.save(block);
      return;
    }
    if (h && !acceptsIngredient(d, h.typeId)) return actionbar(player, tr("nookworks.bedrock.not_accepted"));
    // show the contents
    const parts = [];
    for (const p of d.items) parts.push(itemText(p.id), { text: ` x${p.n}  ` });
    parts.push({ text: d.liquid ? `§3${d.liquid === "oil" ? "🛢" : "💧"} ${d.mb} mB` : "" });
    actionbar(player, { rawtext: parts.length ? parts : [tr("nookworks.bedrock.empty")] });
  },
  tick: ({ block }) => {
    const d = potData(block);
    const hot = heated(block);
    setStates(block, { on_grill: blockAt(block.dimension, add(block.location, DIRS.down))?.typeId === "minecraft:campfire" });
    if (d.dish || !d.items.length) return;
    if (d.settle > 0) {
      d.settle -= TICK;
      return;
    }
    const r = potRecipe(d);
    if (!r || !hot) {
      d.cook = 0;
      return;
    }
    d.cook += TICK;
    if (d.cook >= r.time) {
      d.cook = 0;
      d.items = [];
      d.mb -= r.amount;
      if (d.mb <= 0) {
        d.mb = 0;
        d.liquid = null;
      }
      setStates(block, { liquid: d.liquid ?? "empty" });
      d.dish = { id: bedrockId(r.result.id), n: r.result.count ?? 1, container: r.container ? bedrockId(r.container) : null };
      block.dimension.playSound("random.fizz", block.location, { volume: 0.5 });
    }
    store.save(block);
  },
  broken: ({ block, dim }) => {
    const d = store.getKey(store.keyOf(block));
    if (!d) return;
    dropSlots(dim, block.location, d.items);
    if (d.dish) dropSlots(dim, block.location, [{ id: d.dish.id, n: d.dish.n }]);
  },
});

// ---- Grill: 4 places, cooks what a campfire cooks, in a campfire's time (600 t)
onBlock("grill", {
  interact: ({ block, player }) => {
    const d = store.get(block, () => ({ items: [] }));
    const h = held(player);
    if (h && DATA.campfire[h.typeId] && d.items.length < 4) {
      d.items.push({ id: h.typeId, t: 0 });
      consumeHeld(player);
    } else if (!h && d.items.length) {
      const take = player.isSneaking ? d.items.splice(0) : [d.items.sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0)).shift()];
      for (const it of take) give(player, new ItemStack(it.done ? DATA.campfire[it.id][0] : it.id, 1));
    }
    store.save(block);
  },
  tick: ({ block }) => {
    const d = store.get(block);
    const b = blockAt(block.dimension, add(block.location, DIRS.down));
    setStates(block, { over_fire: !!b && /campfire/.test(b.typeId) });
    if (!d?.items.length) return;
    const hot = heated(block);
    for (const it of d.items) {
      if (it.done) continue;
      it.t = hot ? it.t + TICK : 0;
      if (it.t >= (DATA.campfire[it.id]?.[1] ?? 600)) it.done = true;
    }
    store.save(block);
  },
  broken: ({ block, dim }) => {
    const d = store.getKey(store.keyOf(block));
    for (const it of d?.items ?? []) dropSlots(dim, block.location, [{ id: it.done ? DATA.campfire[it.id][0] : it.id, n: 1 }]);
  },
});

// ---- Nukadoko: 4 slots, carrot/beetroot pickle over 12,000 t of game time (it goes on while unloaded)
onBlock("nukadoko", {
  interact: ({ block, player }) => {
    const d = store.get(block, () => ({ items: [] }));
    const h = held(player);
    const v = h && dataMapLookup(dm("pickling"), h.typeId);
    if (v && d.items.length < 4) {
      d.items.push({ id: h.typeId, at: worldTime(), time: v.time, result: bedrockId(v.result) });
      consumeHeld(player);
    } else if (!h) {
      const now = worldTime();
      const ready = d.items.filter((i) => now - i.at >= i.time);
      const take = player.isSneaking ? ready : ready.slice(0, 1);
      for (const t of take) {
        give(player, new ItemStack(t.result, 1));
        d.items.splice(d.items.indexOf(t), 1);
      }
      if (!take.length && d.items.length)
        actionbar(player, { rawtext: [tr("nookworks.bedrock.pickling", Math.ceil((d.items[0].time - (now - d.items[0].at)) / 1200))] });
    }
    store.save(block);
  },
  broken: ({ block, dim }) => {
    const d = store.getKey(store.keyOf(block));
    for (const it of d?.items ?? []) dropSlots(dim, block.location, [{ id: it.id, n: 1 }]);
  },
});
function worldTime() {
  return world.getAbsoluteTime();
}

// ---- Wooden Tray (4 foods; bread dough rises in 3,600 t) and Plate (one food)
const TRAYABLE = new Set(["nookworks:bread_dough", "nookworks:risen_dough", "nookworks:udon_dough", "nookworks:raw_udon",
  "nookworks:pancake_batter", "minecraft:cake"]);
const isFood = (s) => !!s.getComponent("minecraft:food") || TRAYABLE.has(s.typeId);
function holder(name, size) {
  onBlock(name, {
    interact: ({ block, player }) => {
      const d = store.get(block, () => ({ items: [] }));
      const h = held(player);
      if (h && isFood(h) && d.items.length < size) {
        d.items.push({ id: h.typeId, at: worldTime() });
        consumeHeld(player);
      } else if (!h && d.items.length) {
        const take = player.isSneaking ? d.items.splice(0) : [d.items.pop()];
        for (const t of take) give(player, new ItemStack(t.id, 1));
      }
      store.save(block);
    },
    tick: ({ block }) => {
      const d = store.get(block);
      for (const it of d?.items ?? [])
        if (it.id === "nookworks:bread_dough" && worldTime() - it.at >= 3600) {
          it.id = "nookworks:risen_dough";
          store.save(block);
        }
    },
    broken: ({ block, dim }) => {
      const d = store.getKey(store.keyOf(block));
      for (const it of d?.items ?? []) dropSlots(dim, block.location, [{ id: it.id, n: 1 }]);
    },
  });
}
holder("wooden_tray", 4);
holder("plate", 1);

// ---- hand machines: input -> output after N turns
function handMachine(name, recipe, extraOut) {
  return defineMachine(name, {
    slots: extraOut ? 3 : 2, inputs: [0], outputs: extraOut ? [1, 2] : [1], hopperIn: true,
    claimsEmpty: (player) => !player.isSneaking, noForm: true, // an empty hand turns the handle; sneaking opens the screen
    accepts: (d, p) => !!recipe(p.id),
    lines: ({ d }) => [tr("nookworks.bedrock.turns", d.progress ?? 0)],
    interact({ block, player, d }) {
      if (held(player)) return false;
      if (player.isSneaking) return false;
      crank(block, d);
      return true;
    },
    crank: (block, d) => crank(block, d),
  });
  function crank(block, d) {
    const s = d.slots[0];
    const r = s && recipe(s.id);
    if (!r) return false;
    if (!fits(d, 1, [{ id: r.id, n: r.n }]) || (r.extra && !fits(d, 2, [{ id: "nookworks:rice_bran", n: 1 }]))) return false;
    d.progress = (d.progress ?? 0) + 1;
    block.dimension.playSound("block.grindstone.use", block.location, { volume: 0.5 });
    if (d.progress >= r.turns) {
      d.progress = 0;
      takeFromSlot(d.slots, 0, 1);
      putOut(d, 1, { id: r.id, n: r.n });
      r.extra?.(d);
    }
    store.save(block);
    return true;
  }
}
const mill = (map) => (id) => {
  const v = dataMapLookup(dm(map), id);
  return v && { id: bedrockId(v.result), n: v.count ?? 1, turns: v.turns ?? 1 };
};
handMachine("hand_quern", mill("milling"));
handMachine("noodle_maker", mill("noodle_making"));
handMachine("rice_polisher", (id) => matches("#c:crops/rice", id) || id === "nookworks:brown_rice"
  ? { id: "nookworks:white_rice", n: 1, turns: 3, extra: (d) => {
      d.bran = (d.bran ?? 0) + 1;
      if (d.bran >= 4) {
        d.bran = 0;
        putOut(d, 2, { id: "nookworks:rice_bran", n: 1 });
      }
    } }
  : null, true);

// ---- Oil Press: seeds -> vegetable oil (4,000 mB tank, runs off into pipes) and oil cakes
defineMachine("oil_press", {
  slots: 2, inputs: [0], outputs: [1],
  tanks: { oil: { cap: 4000, gives: true } },
  claimsEmpty: (player) => !player.isSneaking,
  noForm: true,
  accepts: (d, p) => !!dataMapLookup(dm("pressing"), p.id),
  lines: ({ d }) => [tr("nookworks.bedrock.turns", d.progress ?? 0)],
  interact({ block, player, d, spec }) {
    if (held(player) || player.isSneaking) return false;
    spec.crank(block, d);
    return true;
  },
  crank(block, d) {
    const s = d.slots[0];
    const v = s && dataMapLookup(dm("pressing"), s.id);
    if (!v || d.tanks.oil.n + v.oil > 4000) return false;
    d.progress = (d.progress ?? 0) + 1;
    block.dimension.playSound("block.grindstone.use", block.location, { volume: 0.5 });
    if (d.progress >= v.turns) {
      d.progress = 0;
      takeFromSlot(d.slots, 0, 1);
      fill(d.tanks.oil, 4000, "vegetable_oil", v.oil);
      if (Math.random() < v.cake) putOut(d, 1, { id: "nookworks:oil_cake", n: 1 });
    }
    setStates(block, { oil: d.tanks.oil.n > 2000 ? 2 : 1 });
    store.save(block);
    return true;
  },
  work({ block, d }) {
    if (d.tanks.oil.n > 0) {
      d.tanks.oil.n -= pushFluid(block, "vegetable_oil", Math.min(d.tanks.oil.n, 250));
      if (d.tanks.oil.n <= 0) d.tanks.oil = { f: null, n: 0 };
    }
    return "idle";
  },
});
