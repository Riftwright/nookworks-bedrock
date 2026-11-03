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
import { ItemStack } from "@minecraft/server";
import { FLUIDS, FILLED, filledOf, fill, drain, fluidName, registerFluidHolder } from "./fluids.js";

export const machines = new Map();

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
    const slots = spec.inputs.filter((i) => !spec.accepts || spec.accepts(d, p, i));
    const left = addToSlots(d.slots, slots, p);
    if (left !== p.n) store.save(block);
    return left;
  });
  onBlock(name, {
    tick: (ctx) => tick(spec, ctx),
    interact: (ctx) => interact(spec, ctx),
    broken: (ctx) => {
      const d = store.getKey(store.keyOf(ctx.block));
      if (d) {
        dropSlots(ctx.dim ?? ctx.block.dimension, ctx.block.location, d.slots);
        spec.broken?.({ ...ctx, d, spec });
      }
    },
    place: (ctx) => spec.place?.({ ...ctx, d: spec.data(ctx.block), spec }),
    randomTick: spec.randomTick,
  });
  return spec;
}

function tick(spec, { block }) {
  const d = spec.data(block);
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
  store.save(block);
}

/** The Java screen as a form: status, slots and buttons. */
async function interact(spec, ctx) {
  const { block, player } = ctx;
  const d = spec.data(block);
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
    player.sendMessage({ rawtext: [tr("nookworks.bedrock.not_accepted")] });
    return true;
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
    safe(a, "form action")();
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
