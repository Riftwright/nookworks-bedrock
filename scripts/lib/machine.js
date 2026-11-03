// Generic machine: slots, energy, fluid tanks, progress, the form that stands in for Java's screen, hopper input
// and output into the container below.
//
// defineMachine("crusher", {
//   slots: 2, inputs: [0], outputs: [1],
//   energy: { cap: 10000, in: true },            // or { cap, out: 40 } for a generator
//   tanks: { main: { cap: 4000, accepts: (fluid) => bool } },
//   accepts(d, packed, slot) -> bool,            // what may go into an input slot
//   work(ctx) -> "running" | "idle" | "no_power" | "blocked",   // called every TICK
//   lines(ctx) -> [rawtext]                      // extra status lines for the form
//   buttons: [{ label, run(ctx) }]               // extra form buttons
// })
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { onBlock, TICK } from "./blocks.js";
import * as store from "./store.js";
import * as energy from "./energy.js";
import { addToSlots, deliverBelow, pullFromHoppers, dropSlots, takeFromSlot, acceptors } from "./inv.js";
import { held, setHeld, give, setStates, id, short, tr, isCreative, safe } from "./util.js";
import { packItem, unpackItem } from "./store.js";
import { ItemStack, world, system } from "@minecraft/server";
import { FLUIDS, FILLED, filledOf, fill, drain, fluidName, registerFluidHolder } from "./fluids.js";
import { DATA } from "../generated/data.js";
import { registerInv, invs, entityOf, readSlots, writeSlots, dropAndRemove, title } from "./invent.js";

const STATUS_JA = { running: "稼働中", idle: "待機", no_power: "電力なし", no_fuel: "燃料なし", blocked: "出力がいっぱい",
  full: "満杯", redstone: "レッドストーンで停止", no_fluid: "液体なし" };

/** The slots live in the block's inventory entity (the screen the player sees): read them in before a change... */
function slotsIn(spec, block, d) {
  if (!invs.has(spec.typeId)) return;
  if (!entityOf(block, false)) {
    // none yet (just placed, or lost): make it holding what the data holds, rather than reading an empty one
    entityOf(block, true);
    writeSlots(block, d.slots);
    return;
  }
  const s = readSlots(block, spec.slots);
  if (s) d.slots = s;
}

/** For code outside the machine that changes its slots (a Motor turning it, another machine...). */
export function withSlots(spec, block, fn) {
  const d = spec.data(block);
  slotsIn(spec, block, d);
  const r = fn(d);
  slotsOut(spec, block, d);
  store.save(block);
  return r;
}
/** ...and write them back after. */
function slotsOut(spec, block, d) {
  if (invs.has(spec.typeId)) writeSlots(block, d.slots);
}

export const machines = new Map();
const carried = new Map(); // player -> contents of the tank item they are setting down
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const s = e.itemStack;
  if (!s || !machines.get(s.typeId)?.keepsContents) return;
  const raw = s.getDynamicProperty("contents");
  if (raw) carried.set(e.player.id, { ...JSON.parse(raw), t: system.currentTick });
});

export function defineMachine(name, spec) {
  const typeId = id(name);
  spec.typeId = typeId;
  spec.inputs ??= [];
  spec.outputs ??= [];
  machines.set(typeId, spec);
  if (spec.energy) energy.registerHolder(name, spec.energy);
  if (spec.tanks)
    registerFluidHolder(name, (block) => {
      const d = spec.data(block);
      return Object.entries(spec.tanks).map(([t, ts]) => ({ tank: d.tanks[t], cap: ts.cap, accepts: ts.accepts, gives: ts.gives }));
    });
  const init = () => {
    const d = { slots: new Array(spec.slots ?? 0).fill(null), fe: 0, progress: 0 };
    if (spec.tanks) {
      d.tanks = {};
      for (const t of Object.keys(spec.tanks)) d.tanks[t] = { f: null, n: 0 };
    }
    spec.init?.(d);
    return d;
  };
  spec.data = (block) => {
    const d = store.get(block, init);
    if (spec.tanks && !d.tanks) d.tanks = {};
    for (const t of Object.keys(spec.tanks ?? {})) d.tanks[t] ??= { f: null, n: 0 };
    d.slots ??= [];
    return d;
  };
  acceptors.set(typeId, (block, p) => {
    const d = spec.data(block);
    slotsIn(spec, block, d);
    const slots = spec.inputs.filter((i) => !spec.accepts || spec.accepts(d, p, i));
    const left = addToSlots(d.slots, slots, p);
    if (left !== p.n) {
      slotsOut(spec, block, d);
      store.save(block);
    }
    return left;
  });
  if ((spec.slots ?? 0) > 0 && !spec.noInv)
    registerInv(name, {
      size: spec.slots,
      // what a tap with this in hand does instead of opening the screen
      claims: (player, h, block) => (h ? (!!spec.tanks && (!!FILLED[h.typeId] || h.typeId === "minecraft:bucket" || h.typeId === "minecraft:glass_bottle")) || !!spec.claimsItem?.(h) || (!!spec.accepts && spec.inputs.some((i) => spec.accepts(spec.data(block), { id: h.typeId, n: 1 }, i))) : !!spec.claimsEmpty?.(player)),
      use: (player, block) => interact(spec, { block, player, viaEntity: true }),
      form: spec.noForm ? undefined : (player, block) => {
        const d = spec.data(block);
        slotsIn(spec, block, d);
        openForm(spec, block, player);
      },
    });
  onBlock(name, {
    tick: (ctx) => tick(spec, ctx),
    interact: (ctx) => interact(spec, ctx),
    placedBy: ({ block, player }) => {
      const kept = carried.get(player.id);
      carried.delete(player.id);
      if (!spec.keepsContents || !kept || kept.t !== system.currentTick && kept.t !== system.currentTick - 1) return;
      const d = spec.data(block);
      if (kept.tanks) d.tanks = kept.tanks;
      if (kept.fe) d.fe = kept.fe;
      store.save(block);
    },
    broken: (ctx) => {
      const d = store.getKey(store.keyOf(ctx.block));
      if (spec.keepsContents && !(ctx.player && isCreative(ctx.player) && !Object.values(d?.tanks ?? {}).some((t) => t.n))) {
        const s = new ItemStack(typeId, 1);
        if (d && Object.values(d.tanks ?? {}).some((t) => t.n)) {
          s.setDynamicProperty("contents", JSON.stringify({ tanks: d.tanks, fe: d.fe }));
          s.setLore(Object.values(d.tanks).filter((t) => t.n).map((t) => `§7${t.f} ${t.n} mB`));
        }
        (ctx.dim ?? ctx.block.dimension).spawnItem(s, ctx.block.center());
      }
      if (invs.has(typeId)) dropAndRemove(ctx.block, ctx.dim);
      else if (d) dropSlots(ctx.dim ?? ctx.block.dimension, ctx.block.location, d.slots);
      if (d) spec.broken?.({ ...ctx, d, spec });
    },
    place: (ctx) => {
      if (invs.has(typeId)) entityOf(ctx.block);
      spec.place?.({ ...ctx, d: spec.data(ctx.block), spec });
    },
    randomTick: spec.randomTick,
  });
  return spec;
}

function tick(spec, { block }) {
  const d = spec.data(block);
  slotsIn(spec, block, d);
  if (spec.accepts)
    for (const i of spec.inputs) {
      const p = d.slots[i];
      if (p && !spec.accepts(d, p, i)) {
        deliverBelow(block, p, { dir: "up" });
        d.slots[i] = null;
      }
    }
  for (const i of spec.outputs) if (d.slots[i] && !d.slots[i].id) d.slots[i] = null;
  const ctx = { block, d, spec, dt: TICK };
  // hoppers feed the inputs
  if (spec.inputs.length && spec.hopperIn !== false) {
    pullFromHoppers(block, (p) => {
      const slots = spec.inputs.filter((i) => !spec.accepts || spec.accepts(d, p, i));
      return p.n - addToSlots(d.slots, slots, p);
    }, spec.hopperRate ?? 1);
  }
  const status = spec.work ? spec.work(ctx) : "idle";
  d.status = status;
  // finished things go below
  if (spec.outputs.length && spec.autoOut !== false) {
    for (const i of spec.outputs) {
      const p = d.slots[i];
      if (!p) continue;
      const left = deliverBelow(block, p, { noDrop: spec.keepOutputs, dir: spec.outDir?.(ctx) ?? "down" });
      d.slots[i] = left > 0 ? { ...p, n: left } : null;
    }
  }
  // generators push their energy on
  if (spec.energy?.out && d.fe > 0) d.fe -= energy.push(block, Math.min(d.fe, spec.energy.out * TICK));
  const running = status === "running";
  setStates(block, { running, lit: running, powered: running });
  slotsOut(spec, block, d);
  if (invs.has(spec.typeId)) {
    // the screen's title and the name shown when looked at: what it is doing
    const e = entityOf(block);
    let t = title(spec.typeId) + "  " + (STATUS_JA[status] ?? "");
    if (spec.energy) t += `  ⚡${energy.fmt(d.fe ?? 0)}/${energy.fmt(spec.energy.cap)}`;
    const max = typeof spec.progressMax === "function" ? spec.progressMax(ctx) : spec.progressMax;
    if (max && d.progress) t += `  ${Math.floor((100 * d.progress) / max)}%`;
    for (const [k, tank] of Object.entries(d.tanks ?? {})) if (tank.n) t += `  ${tank.n}mB`;
    if (e && e.nameTag !== t) e.nameTag = t;
  }
  store.save(block);
}

/** The Java screen as a form: status, slots and buttons. */
async function interact(spec, ctx) {
  const { block, player } = ctx;
  const d = spec.data(block);
  slotsIn(spec, block, d);
  try {
    await interactInner(spec, ctx, d);
  } finally {
    slotsOut(spec, block, d);
  }
}

async function interactInner(spec, ctx, d) {
  const { block, player } = ctx;
  if (invs.has(spec.typeId) && !ctx.viaEntity) entityOf(block); // a block reached before its entity was made
  const h = held(player);
  if (spec.interact && spec.interact({ ...ctx, d, spec }) === true) {
    store.save(block);
    return;
  }
  if (h && spec.tanks && pourContainer(spec, d, player, h)) {
    store.save(block);
    return;
  }
  // held item that fits an input goes straight in
  if (h && !player.isSneaking) {
    const p = packItem(h);
    const slots = spec.inputs.filter((i) => !spec.accepts || spec.accepts(d, p, i));
    if (slots.length) {
      const left = addToSlots(d.slots, slots, p);
      if (left !== p.n) {
        if (!isCreative(player)) {
          if (left > 0) {
            h.amount = left;
            setHeld(player, h);
          } else setHeld(player, undefined);
        }
        store.save(block);
        return;
      }
    }
  }
  openForm(spec, block, player);
}

/** A bucket or bottle used on a machine with tanks pours in, or an empty one draws out. */
function pourContainer(spec, d, player, h) {
  const f = FILLED[h.typeId];
  if (f) {
    const [fl, n, empty] = f;
    for (const [t, ts] of Object.entries(spec.tanks)) {
      if (ts.accepts && !ts.accepts(fl)) continue;
      const tank = d.tanks[t];
      if ((tank.f && tank.f !== fl) || ts.cap - tank.n < n) continue;
      fill(tank, ts.cap, fl, n);
      if (!isCreative(player)) swapHeld(player, h, empty);
      player.dimension.playSound("bucket.empty_water", player.location);
      return true;
    }
    return false;
  }
  if (h.typeId === "minecraft:bucket" || h.typeId === "minecraft:glass_bottle") {
    for (const [t, ts] of Object.entries(spec.tanks)) {
      const tank = d.tanks[t];
      if (!ts.gives || !tank.f) continue;
      const got = filledOf(h.typeId, tank.f);
      if (!got || tank.n < got[1]) continue;
      drain(tank, got[1]);
      swapHeld(player, h, got[0]);
      player.dimension.playSound("bucket.fill_water", player.location);
      return true;
    }
  }
  return false;
}

function swapHeld(player, h, newId) {
  if (h.amount > 1) {
    h.amount -= 1;
    setHeld(player, h);
    give(player, new ItemStack(newId, 1));
  } else setHeld(player, new ItemStack(newId, 1));
}

export function statusLines(spec, ctx) {
  const { d } = ctx;
  const lines = [];
  if (d.status) lines.push(tr(`nookworks.bedrock.status.${d.status}`), { text: "\n" });
  if (spec.energy) lines.push(tr("nookworks.bedrock.energy", `${energy.fmt(d.fe ?? 0)} / ${energy.fmt(spec.energy.cap)} FE`), { text: "\n" });
  if (spec.progressMax) {
    const max = typeof spec.progressMax === "function" ? spec.progressMax(ctx) : spec.progressMax;
    if (max) lines.push(tr("nookworks.bedrock.progress", `${Math.floor((100 * (d.progress ?? 0)) / max)}%`), { text: "\n" });
  }
  for (const [t, tank] of Object.entries(d.tanks ?? {})) {
    const cap = spec.tanks[t]?.cap ?? 0;
    lines.push({ text: "§3" }, tank.f ? fluidName(tank.f) : tr("nookworks.bedrock.empty"), { text: `§r ${tank.n} / ${cap} mB\n` });
  }
  for (const l of spec.lines?.(ctx) ?? []) lines.push(l, { text: "\n" });
  return lines;
}

export async function openForm(spec, block, player) {
  const d = spec.data(block);
  const ctx = { block, d, spec, player };
  const form = new ActionFormData().title({ rawtext: [{ translate: `block.nookworks.${short(spec.typeId)}` }] });
  const body = statusLines(spec, ctx);
  const slotIdx = [];
  (d.slots ?? []).forEach((p, i) => {
    if (p) slotIdx.push(i);
  });
  body.push({ text: "\n" });
  form.body({ rawtext: body.length ? body : [{ text: " " }] });
  const actions = [];
  for (const i of slotIdx) {
    const p = d.slots[i];
    const role = spec.outputs.includes(i) ? "§2▶ " : spec.inputs.includes(i) ? "§9◀ " : "§7■ ";
    form.button({ rawtext: [{ text: role }, itemText(p.id), { text: ` §rx${p.n}` }] });
    actions.push(() => {
      const t = takeFromSlot(d.slots, i, p.n);
      if (t) give(player, unpackItem(t));
      store.save(block);
    });
  }
  const h = held(player);
  if (h && spec.inputs.length) {
    form.button({ rawtext: [tr("nookworks.bedrock.put_in"), { text: " " }, itemText(h.typeId)] });
    actions.push(() => {
      const p = packItem(h);
      const slots = spec.inputs.filter((i) => !spec.accepts || spec.accepts(d, p, i));
      const left = addToSlots(d.slots, slots, p);
      if (left === p.n) player.sendMessage({ rawtext: [tr("nookworks.bedrock.not_accepted")] });
      else if (!isCreative(player)) {
        if (left) {
          h.amount = left;
          setHeld(player, h);
        } else setHeld(player, undefined);
      }
      store.save(block);
    });
  }
  for (const b of spec.buttons ?? []) {
    if (b.when && !b.when(ctx)) continue;
    form.button(typeof b.label === "function" ? b.label(ctx) : b.label);
    actions.push(() => b.run(ctx));
  }
  form.button({ rawtext: [tr("gui.done")] });
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const a = actions[res.selection];
  if (a) {
    if (!block.isValid || block.typeId !== spec.typeId || store.getKey(store.keyOf(block)) !== d) return;
    slotsIn(spec, block, d);
    safe(a, "form action")();
    slotsOut(spec, block, d);
    store.save(block);
  }
}

const nameKeys = new Map();
/** rawtext for an item's name, from the game's own localization key. */
export function itemText(typeId) {
  let k = nameKeys.get(typeId);
  if (k === undefined && typeId.startsWith("nookworks:")) k = DATA.nameKeys[typeId.slice(10)] ?? null;
  if (k === undefined) {
    try {
      k = new ItemStack(typeId, 1).localizationKey;
    } catch {
      k = null;
    }
    nameKeys.set(typeId, k);
  }
  return k ? { translate: k } : { text: typeId };
}

// ---- small helpers for work() functions

export function useEnergy(d, n) {
  if ((d.fe ?? 0) < n) return false;
  d.fe -= n;
  return true;
}

export function spaceFor(d, slot, p) {
  const cur = d.slots[slot];
  if (!cur) return true;
  return cur.id === p.id && cur.n + p.n <= store.maxStack(p.id);
}

export function putOut(d, slots, p) {
  return addToSlots(d.slots, [].concat(slots), p);
}

/** Would all of outs fit into these slots? (tried on a copy) */
export function fits(d, slots, outs) {
  const copy = d.slots.map((s) => (s ? { ...s } : null));
  for (const o of outs) if (o && o.n > 0 && addToSlots(copy, [].concat(slots), o) > 0) return false;
  return true;
}
