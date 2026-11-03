import { test } from "./registry.js";
import * as store from "../lib/store.js";
import { acceptors, containerOf } from "../lib/inv.js";
import { machines } from "../lib/machine.js";
import { handlers } from "../lib/blocks.js";
import { ItemStack } from "@minecraft/server";

const data = (b) => machines.get(b.typeId)?.data(b) ?? store.get(b);
const st = (b, s) => b.permutation.getState(s.includes(":") ? s : "nookworks:" + s);
const rt = (t, x, y, z, n) => {
  for (let i = 0; i < n; i++) handlers.get(t.block(x, y, z).typeId)?.randomTick?.({ block: t.block(x, y, z) });
};

test("crop_onions_grow", async (t) => {
  t.set(0, 0, 0, "minecraft:farmland");
  t.set(0, 1, 0, "nookworks:onions");
  rt(t, 0, 1, 0, 400);
  t.eq(st(t.block(0, 1, 0), "age"), 7);
});

test("crop_corn_two_tall", async (t) => {
  t.set(0, 0, 0, "minecraft:farmland");
  t.set(0, 1, 0, "nookworks:corn");
  rt(t, 0, 1, 0, 2000);
  t.eq(st(t.block(0, 1, 0), "age"), 5, "lower ripe");
  t.eq(t.block(0, 2, 0).typeId, "nookworks:corn", "upper half");
});

test("crop_rice_heads_up", async (t) => {
  t.set(0, 0, 0, "minecraft:dirt");
  t.set(0, 1, 0, "nookworks:rice");
  rt(t, 0, 1, 0, 200);
  t.eq(t.block(0, 2, 0).typeId, "nookworks:rice_panicles");
});

test("logistics_item_warp", async (t) => {
  const s = t.set(0, 1, 0, "nookworks:item_warp_sender");
  t.set(0, 8, 0, "nookworks:item_warp_receiver");
  t.set(0, 7, 0, "minecraft:chest");
  acceptors.get("nookworks:item_warp_sender")(s, { id: "minecraft:dirt", n: 5 });
  t.tick(0, 1, 0, 2);
  t.eq(containerOf(t.block(0, 7, 0)).getItem(0)?.amount, 5);
});

test("logistics_sorter_splits", async (t) => {
  const s = t.set(1, 1, 1, "nookworks:item_sorter", { "minecraft:cardinal_direction": "north" });
  t.set(1, 2, 1, "minecraft:chest");
  t.set(0, 1, 1, "minecraft:chest"); // west = right of a north-facing sorter
  t.set(2, 1, 1, "minecraft:chest"); // east = left
  t.tick(1, 1, 1);
  store.get(t.block(1, 1, 1)).filter = ["minecraft:dirt"];
  const top = containerOf(t.block(1, 2, 1));
  top.addItem(new ItemStack("minecraft:dirt", 2));
  top.addItem(new ItemStack("minecraft:stone", 2));
  for (let i = 0; i < 10; i++) t.tick(1, 1, 1);
  const right = containerOf(t.block(0, 1, 1)).getItem(0), left = containerOf(t.block(2, 1, 1)).getItem(0);
  t.check(right?.typeId === "minecraft:dirt" && left?.typeId === "minecraft:stone", `right ${right?.typeId} left ${left?.typeId}`);
});

test("logistics_magnet_chest", async (t) => {
  t.set(0, 1, 0, "nookworks:magnet_chest");
  t.dim.spawnItem(new ItemStack("minecraft:apple", 3), t.at(2.5, 1.5, 0.5));
  t.tick(0, 1, 0);
  t.eq(store.get(t.block(0, 1, 0)).slots[0]?.n, 3);
});

test("fluid_pump_to_tank", async (t) => {
  t.set(0, 0, 0, "minecraft:water");
  t.set(-1, 0, 0, "minecraft:water");
  t.set(1, 0, 0, "minecraft:water");
  const p = t.set(0, 1, 0, "nookworks:water_pump");
  t.set(1, 1, 0, "nookworks:copper_pipe");
  const tank = t.set(2, 1, 0, "nookworks:copper_tank");
  data(p).fe = 10000;
  for (let i = 0; i < 12; i++) t.tick(0, 1, 0);
  t.check(data(tank).tanks.main.n >= 1000, `tank has ${data(tank).tanks.main.n}`);
  t.eq(t.block(0, 0, 0).typeId, "minecraft:water", "infinite source kept");
});

test("kitchen_quern_flour", async (t) => {
  const q = t.set(0, 1, 0, "nookworks:hand_quern");
  acceptors.get("nookworks:hand_quern")(q, { id: "minecraft:wheat", n: 1 });
  const spec = machines.get("nookworks:hand_quern");
  for (let i = 0; i < 3; i++) spec.crank(q, data(q));
  t.eq(data(q).slots[1]?.id, "nookworks:flour");
});

test("kitchen_oil_press", async (t) => {
  const p = t.set(0, 1, 0, "nookworks:oil_press");
  acceptors.get("nookworks:oil_press")(p, { id: "nookworks:sunflower_seeds", n: 2 });
  const spec = machines.get("nookworks:oil_press");
  for (let i = 0; i < 4; i++) spec.crank(p, data(p));
  t.eq(data(p).tanks.oil.n, 120);
});

test("mercury_retort_cinnabar", async (t) => {
  const r = t.set(0, 1, 0, "nookworks:retort");
  data(r).fe = 10000;
  acceptors.get("nookworks:retort")(r, { id: "minecraft:cinnabar", n: 1 });
  t.tick(0, 1, 0, 11);
  t.check(data(r).tanks.mercury.n === 250 || data(r).slots[0] === null, `mercury ${data(r).tanks.mercury.n}, slot ${JSON.stringify(data(r).slots[0])}`);
});

test("recycler_iron_sword", async (t) => {
  const r = t.set(0, 1, 0, "nookworks:recycler");
  data(r).fe = 20000;
  const left = acceptors.get("nookworks:recycler")(r, { id: "minecraft:iron_sword", n: 1 });
  t.eq(left, 0, "accepted");
  t.tick(0, 1, 0, 15);
  t.eq(data(r).slots[0], null);
});

test("drive_motor_cranks_quern", async (t) => {
  const m = t.set(0, 1, 0, "nookworks:motor", { "minecraft:facing_direction": "east" });
  const q = t.set(1, 1, 0, "nookworks:hand_quern");
  machines.get("nookworks:motor").data(m).fe = 10000;
  acceptors.get("nookworks:hand_quern")(q, { id: "minecraft:wheat", n: 1 });
  t.tick(0, 1, 0, 3);
  t.eq(data(q).slots[1]?.id, "nookworks:flour");
});

test("planter_plants_wheat", async (t) => {
  const p = t.set(2, 1, 0, "nookworks:planter", { "minecraft:cardinal_direction": "south" });
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 5; z++) t.set(x, 0, z, "minecraft:farmland");
  machines.get("nookworks:planter").data(p).fe = 10000;
  acceptors.get("nookworks:planter")(p, { id: "minecraft:wheat_seeds", n: 20 });
  t.tick(2, 1, 0, 16);
  let n = 0;
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 5; z++) if (t.block(x, 1, z).typeId === "minecraft:wheat") n++;
  t.eq(n, 15);
});

test("repair_box_repairs", async (t) => {
  const r = t.set(0, 1, 0, "nookworks:repair_box");
  const d = machines.get("nookworks:repair_box").data(r);
  d.fe = 20000;
  d.tanks.xp = { f: "experience", n: 4000 };
  acceptors.get("nookworks:repair_box")(r, { id: "minecraft:iron_pickaxe", n: 1, dmg: 20 });
  t.tick(0, 1, 0, 3);
  t.eq(d.slots[0]?.dmg, 5);
});

test("barter_needs_piglin", async (t) => {
  const b = t.set(0, 1, 0, "nookworks:barter_terminal");
  const d = machines.get("nookworks:barter_terminal").data(b);
  d.fe = 20000;
  acceptors.get("nookworks:barter_terminal")(b, { id: "minecraft:gold_ingot", n: 3 });
  t.dim.spawnEntity("minecraft:piglin", t.at(2, 1, 0));
  t.tick(0, 1, 0, 13);
  t.check(d.slots[0]?.n !== 3, "gold taken");
});
