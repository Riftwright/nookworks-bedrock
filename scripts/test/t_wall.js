import { test } from "./registry.js";
import { sleep } from "./runner.js";
import { DATA } from "../generated/data.js";
import { acceptors } from "../lib/inv.js";
import { machines } from "../lib/machine.js";

test("poster_entities_spawn", async (t) => {
  for (const [name, info] of Object.entries(DATA.posterIndex)) {
    const e = t.dim.spawnEntity(info.entity, t.at(2, 2, 2));
    e.setProperty("nookworks:design", info.design);
    await sleep(2);
    t.eq(e.getProperty("nookworks:design"), info.design, name);
    e.remove();
  }
});

test("span_entities_spawn", async (t) => {
  for (const k of ["rope", "chain"]) {
    const e = t.dim.spawnEntity(`nookworks:${k}_span`, t.at(2, 2, 2));
    e.setProperty("nookworks:length", 7.5);
    e.setProperty("nookworks:pitch", -12);
    await sleep(2);
    t.eq(e.getProperty("nookworks:length"), 7.5);
    e.remove();
  }
  t.dim.spawnEntity("nookworks:label", t.at(2, 2, 2)).remove();
});

test("printing_press_prints", async (t) => {
  const p = t.set(0, 1, 0, "nookworks:printing_press");
  const spec = machines.get("nookworks:printing_press");
  const d = spec.data(p);
  d.fe = 10000;
  const acc = acceptors.get("nookworks:printing_press");
  acc(p, { id: "nookworks:fine_paper", n: 2 });
  for (const ink of ["minecraft:cyan_dye", "minecraft:magenta_dye", "minecraft:yellow_dye", "minecraft:black_dye"]) acc(p, { id: ink, n: 2 });
  d.job = "koi";
  t.set(0, 0, 0, "minecraft:chest");
  t.tick(0, 1, 0, 7);
  t.eq(d.slots[0]?.n, 1, "one sheet used");
});
