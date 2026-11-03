import { test } from "./registry.js";
import { sleep } from "./runner.js";
test("probe_villager", async (t) => {
  const v = t.dim.spawnEntity("minecraft:villager_v2", t.at(2, 1, 2));
  await sleep(40);
  const fam = v.getComponent("minecraft:type_family");
  console.warn(`[nookworks-test] PROBE villager mark=${v.getComponent("minecraft:mark_variant")?.value} variant=${v.getComponent("minecraft:variant")?.value} skin=${v.getComponent("minecraft:skin_id")?.value} fam=${fam?.getTypeFamilies?.().join(",")}`);
});
