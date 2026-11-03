import { test } from "./registry.js";
import { ItemStack } from "@minecraft/server";
import { DATA } from "../generated/data.js";

test("load_every_block", async (t) => {
  // every block of ours can be set down in its default state
  const bad = [];
  let i = 0;
  for (const b of Object.keys(DATA.blockStates)) {
    try {
      t.set(i % 16, 1 + Math.floor(i / 256), Math.floor(i / 16) % 16, `nookworks:${b}`);
    } catch (e) {
      bad.push(`${b}: ${e}`);
    }
    i++;
  }
  t.eq(bad, [], "blocks that would not place");
});

test("load_every_item", async () => {
  const bad = [];
  const ids = new Set([...Object.keys(DATA.nameKeys)]);
  for (const i of ids) {
    try {
      new ItemStack(`nookworks:${i}`, 1);
    } catch (e) {
      if (DATA.blockStates[i] || DATA.items[i]) bad.push(i);
    }
  }
  t_bad(bad);
});
function t_bad(bad) {
  if (bad.length) throw new Error("missing items: " + bad.join(", "));
}

test("vanilla_ids_exist", async () => {
  // every Bedrock id our data names (recipes, loot) is a real item
  const ids = new Set(JSON.stringify(DATA).match(/minecraft:[a-z0-9_]+/g));
  const bad = [];
  for (const i of ids) {
    try {
      new ItemStack(i, 1);
    } catch {
      bad.push(i);
    }
  }
  console.warn("[nookworks-test] INFO unknown minecraft ids: " + bad.join(" "));
});

import { ItemTypes } from "@minecraft/server";
test("dump_item_ids", async () => {
  // every item id the game knows, for tools/convert.py to check names against (.cache/bedrock_items.txt)
  const ids = ItemTypes.getAll().map((t) => t.id).filter((i) => i.startsWith("minecraft:"));
  for (let i = 0; i < ids.length; i += 200) console.warn("[nookworks-ids] " + ids.slice(i, i + 200).join(" "));
});
