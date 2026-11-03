import { test } from "./registry.js";
import { sleep } from "./runner.js";
import * as store from "../lib/store.js";
import { acceptors, containerOf } from "../lib/inv.js";
import { machines } from "../lib/machine.js";

const data = (b) => machines.get(b.typeId)?.data(b) ?? store.get(b);

test("machine_generator_powers_crusher", async (t) => {
  const gen = t.set(0, 1, 0, "nookworks:generator");
  t.set(1, 1, 0, "nookworks:energy_cable");
  const cr = t.set(2, 1, 0, "nookworks:crusher");
  t.set(2, 0, 0, "minecraft:chest");
  acceptors.get("nookworks:generator")(gen, { id: "minecraft:coal", n: 1 });
  acceptors.get("nookworks:crusher")(cr, { id: "minecraft:cobblestone", n: 2 });
  for (let i = 0; i < 30; i++) {
    t.tick(0, 1, 0);
    t.tick(2, 1, 0);
  }
  const c = containerOf(t.block(2, 0, 0));
  const got = c.getItem(0);
  t.check(got?.typeId === "minecraft:gravel" && got.amount === 2, `chest under crusher has ${got?.typeId} x${got?.amount}; crusher fe ${data(cr).fe}`);
});

test("machine_sifter_hopper_fed", async (t) => {
  const s = t.set(0, 2, 0, "nookworks:sifter");
  t.set(0, 1, 0, "minecraft:chest");
  acceptors.get("nookworks:sifter")(s, { id: "minecraft:gravel", n: 4 });
  t.tick(0, 2, 0, 20);
  t.eq(data(s).slots[0], null, "gravel all sifted");
});

test("machine_electric_furnace_smelts", async (t) => {
  const f = t.set(0, 1, 0, "nookworks:electric_furnace");
  data(f).fe = 20000;
  acceptors.get("nookworks:electric_furnace")(f, { id: "minecraft:raw_iron", n: 1 });
  t.set(0, 0, 0, "minecraft:chest");
  t.tick(0, 1, 0, 12);
  t.eq(containerOf(t.block(0, 0, 0)).getItem(0)?.typeId, "minecraft:iron_ingot");
});

test("storage_barrel_insert_take", async (t) => {
  const b = t.set(0, 1, 0, "nookworks:iron_storage_barrel");
  const left = acceptors.get("nookworks:iron_storage_barrel")(b, { id: "minecraft:cobblestone", n: 64 * 60 });
  // 27 slots x 2 stacks
  t.eq(left, 64 * 60 - 27 * 128, "overflow");
  t.eq(data(b).items.length, 27);
});

test("kitchen_pot_boils_egg", async (t) => {
  t.set(0, 0, 0, "minecraft:magma");
  const pot = t.set(0, 1, 0, "nookworks:iron_pot");
  const d = store.get(pot, () => ({ items: [], liquid: null, mb: 0, dish: null, cook: 0, settle: 0 }));
  d.items = [{ id: "minecraft:egg", n: 1 }];
  d.liquid = "water";
  d.mb = 1000;
  t.tick(0, 1, 0, 40);
  t.eq(store.get(pot).dish?.id, "nookworks:boiled_egg");
});

test("compressor_nine_iron", async (t) => {
  const c = t.set(0, 1, 0, "nookworks:compressor");
  data(c).fe = 10000;
  acceptors.get("nookworks:compressor")(c, { id: "minecraft:iron_ingot", n: 9 });
  t.tick(0, 1, 0, 5);
  t.eq(data(c).slots[1]?.id ?? "below", "below");
});
