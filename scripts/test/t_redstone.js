import { test } from "./registry.js";
import { sleep } from "./runner.js";
test("redstone_producer_works", async (t) => {
  const b = t.set(0, 1, 0, "nookworks:dawnwood_pressure_plate", { "nookworks:powered": true });
  t.set(1, 1, 0, "minecraft:redstone_lamp");
  await sleep(4);
  console.warn("[nookworks-test] INFO lamp next to powered plate: " + t.block(1, 1, 0).typeId + " power " + t.block(1, 1, 0).getRedstonePower());
});
