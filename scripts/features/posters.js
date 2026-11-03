// Printing Press, posters and labels (docs/java_spec.md §2, §15).
// A poster is an item per design; used on a wall it hangs a poster entity of its size, centred on the clicked
// block. Hit it to take it down. Labels hang a small plaque that shows the label item's name (rename it at an anvil).
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { defineMachine, useEnergy, putOut } from "../lib/machine.js";
import { TICK } from "../lib/blocks.js";
import { DATA } from "../generated/data.js";
import { takeFromSlot } from "../lib/inv.js";
import { held, setHeld, isCreative, tr, safe } from "../lib/util.js";
import { setting } from "./settings.js";

const P = DATA.posterIndex;
const INKS = ["minecraft:cyan_dye", "minecraft:magenta_dye", "minecraft:yellow_dye", "minecraft:black_dye"];
const PAPER = "nookworks:fine_paper";
const inkNeed = (design) => {
  const n = { 1: 1, 2: 1, 3: 1, 4: 1 };
  if (design === "label") return n;
  const inks = P[design]?.inks;
  if (inks) {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const [k, v] of Object.entries(inks)) out[{ cyan: 1, magenta: 2, yellow: 3, black: 4 }[k.replace(/^.*[:_]/, "")] ?? 4] += v;
    return out;
  }
  return n;
};

defineMachine("printing_press", {
  slots: 6, inputs: [0, 1, 2, 3, 4], outputs: [5], energy: { cap: 10000, in: true },
  progressMax: () => 60,
  accepts: (d, p, i) => (i === 0 ? p.id === PAPER || p.id === "minecraft:paper" : p.id === INKS[i - 1]),
  lines: ({ d }) => [d.job ? { rawtext: [tr("gui.nookworks.printing_press.printing", Math.floor(((d.progress ?? 0) * 100) / 60)), { text: " " }, d.job === "label" ? tr("item.nookworks.label") : tr(`poster.nookworks.${d.job}`)] } : tr("gui.nookworks.printing_press.none")],
  buttons: [
    { label: { rawtext: [tr("gui.nookworks.printing_press.print"), { text: "…" }] }, run: ({ block, player, d }) => system.run(() => pick(block, player, d)) },
    { label: { rawtext: [tr("gui.nookworks.printing_press.stop")] }, when: ({ d }) => !!d.job, run: ({ d }) => ((d.job = null), (d.progress = 0)) },
  ],
  work({ d }) {
    if (!d.job) return "idle";
    const need = inkNeed(d.job);
    if (!d.slots[0] || [1, 2, 3, 4].some((i) => need[i] && (d.slots[i]?.n ?? 0) < need[i])) {
      d.job = null;
      d.progress = 0;
      return "idle";
    }
    const out = d.job === "label" ? { id: "nookworks:label", n: 8 } : { id: `nookworks:poster_${d.job}`, n: 1 };
    if (d.slots[5] && (d.slots[5].id !== out.id || d.slots[5].n + out.n > 16)) return "blocked";
    if (!useEnergy(d, Math.ceil(20 * setting("machineEnergy")) * TICK)) return "no_power";
    d.progress += TICK;
    if (d.progress >= 60) {
      d.progress = 0;
      takeFromSlot(d.slots, 0, 1);
      for (const i of [1, 2, 3, 4]) if (need[i]) takeFromSlot(d.slots, i, need[i]);
      putOut(d, 5, out);
      d.job = null; // one copy per Print, as in Java
    }
    return "running";
  },
});

async function pick(block, player, d) {
  const names = Object.keys(P).sort((a, b) => P[a].w * P[a].h - P[b].w * P[b].h || (a < b ? -1 : 1));
  const f = new ActionFormData().title({ rawtext: [tr("block.nookworks.printing_press")] });
  f.button({ rawtext: [tr("item.nookworks.label"), { text: " x8" }] });
  for (const n of names) f.button({ rawtext: [tr(`poster.nookworks.${n}`), { text: `  §8${P[n].w}×${P[n].h}` }] }, `textures/nookworks/poster/${n}`);
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  d.job = r.selection === 0 ? "label" : names[r.selection - 1];
  d.progress = 0;
}

// ---- hanging
const FACE_YAW = { North: 180, South: 0, East: 270, West: 90 };
const FACE_OFF = { North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const s = e.itemStack;
  if (!e.isFirstEvent || !s || !FACE_YAW.hasOwnProperty(e.blockFace)) return;
  const isPoster = s.typeId.startsWith("nookworks:poster_");
  const isLabel = s.typeId === "nookworks:label";
  if (!isPoster && !isLabel) return;
  e.cancel = true;
  const { block, player, blockFace } = e;
  const fl = e.faceLocation;
  system.run(
    safe(() => {
      const o = FACE_OFF[blockFace];
      const c = block.center();
      let pos;
      let ent;
      if (isPoster) {
        const info = P[s.typeId.slice("nookworks:poster_".length)];
        if (!info) return;
        // centred on the clicked block, the bottom row at its level
        pos = { x: c.x + o[0] * 0.53, y: block.location.y + (info.h > 1 ? 0 : 0), z: c.z + o[2] * 0.53 };
        ent = block.dimension.spawnEntity(info.entity, pos);
        ent.setProperty("nookworks:design", info.design);
      } else {
        // a label sits where it was clicked (sneak: centred on the face)
        const at = player.isSneaking || !fl ? { x: c.x, y: block.location.y + 0.31, z: c.z } : { x: fl.x, y: fl.y - 0.19, z: fl.z };
        pos = { x: o[0] ? c.x + o[0] * 0.505 : at.x, y: at.y, z: o[2] ? c.z + o[2] * 0.505 : at.z };
        ent = block.dimension.spawnEntity("nookworks:label", pos);
        if (s.nameTag) ent.nameTag = s.nameTag;
      }
      ent.setRotation({ x: 0, y: FACE_YAW[blockFace] });
      ent.setDynamicProperty("item", s.typeId);
      if (s.nameTag) ent.setDynamicProperty("name", s.nameTag);
      ent.setDynamicProperty("wall", JSON.stringify(block.location));
      if (!isCreative(player)) {
        if (s.amount > 1) {
          s.amount--;
          setHeld(player, s);
        } else setHeld(player, undefined);
      }
      block.dimension.playSound("block.itemframe.place", pos);
    }, "hang")
  );
});

function takeDown(ent, player) {
  const item = ent.getDynamicProperty("item");
  if (item && !(player && isCreative(player))) {
    const s = new ItemStack(item, 1);
    const n = ent.getDynamicProperty("name");
    if (n) s.nameTag = n;
    ent.dimension.spawnItem(s, ent.location);
  }
  ent.dimension.playSound("block.itemframe.break", ent.location);
  ent.remove();
}

const HUNG = /^nookworks:(poster_\d+x\d+|label)$/;
world.afterEvents.entityHitEntity.subscribe(
  safe((e) => {
    if (HUNG.test(e.hitEntity.typeId)) takeDown(e.hitEntity, e.damagingEntity);
  }, "poster hit")
);
// the wall gone, it falls
system.runInterval(
  safe(() => {
    for (const dim of ["overworld", "nether", "the_end"].map((d) => world.getDimension(d)))
      for (const ent of dim.getEntities({ families: ["inanimate"] })) {
        if (!HUNG.test(ent.typeId)) continue;
        const w = ent.getDynamicProperty("wall");
        if (!w) continue;
        const b = dim.getBlock(JSON.parse(w));
        if (b && b.isAir) takeDown(ent);
      }
  }, "poster walls"),
  40
);
