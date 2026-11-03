// In-game tests (dev builds only: tools/convert.py --dev). `/scriptevent nookworks:test [prefix|all]` runs them on
// a ticking area far from spawn and prints "[nookworks-test] PASS|FAIL name" lines, then DONE.
import { world, system, BlockPermutation } from "@minecraft/server";
import { handlers } from "../lib/blocks.js";

import { tests } from "./registry.js";
export { test } from "./registry.js";

const ORIGIN = { x: 20000, y: -50, z: 20000 };

export const sleep = (t) => new Promise((r) => system.runTimeout(r, t));

export class T {
  constructor(name) {
    // tests run one after another on the same cleared plot
    this.name = name;
    this.base = { ...ORIGIN };
    this.dim = world.getDimension("overworld");
  }
  at(x, y, z) {
    return { x: this.base.x + x, y: this.base.y + y, z: this.base.z + z };
  }
  block(x, y, z) {
    return this.dim.getBlock(this.at(x, y, z));
  }
  set(x, y, z, typeId, states) {
    const b = this.block(x, y, z);
    b.setPermutation(BlockPermutation.resolve(typeId, states ?? {}));
    const h = handlers.get(typeId);
    h?.place?.({ block: b });
    return b;
  }
  /** Calls the block's tick handler n times (each stands for TICK game ticks). */
  tick(x, y, z, n = 1) {
    const b = this.block(x, y, z);
    const h = handlers.get(b.typeId);
    for (let i = 0; i < n; i++) h?.tick?.({ block: this.block(x, y, z) });
  }
  check(cond, msg) {
    if (!cond) throw new Error(msg ?? "check failed");
  }
  eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg ?? "expected equal"}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
  clear() {
    const a = this.at(-2, -1, -2), b = this.at(20, 12, 20);
    this.dim.runCommand(`fill ${a.x} ${a.y} ${a.z} ${b.x} ${a.y} ${b.z} stone`);
    this.dim.runCommand(`fill ${a.x} ${a.y + 1} ${a.z} ${b.x} ${b.y} ${b.z} air`);
    for (const e of this.dim.getEntities({ location: this.at(9, 5, 9), maxDistance: 20 })) if (e.typeId !== "minecraft:player") e.remove();
  }
}

async function runAll(prefix) {
  const dim = world.getDimension("overworld");
  try {
    dim.runCommand(`tickingarea remove nwtest`);
  } catch {}
  dim.runCommand(`tickingarea add ${ORIGIN.x - 8} 0 ${ORIGIN.z - 8} ${ORIGIN.x + 32} 0 ${ORIGIN.z + 32} nwtest`);
  await sleep(60);
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (prefix !== "all" && !t.name.startsWith(prefix)) continue;
    const ctx = new T(t.name);
    try {
      ctx.clear();
      await t.fn(ctx);
      console.warn(`[nookworks-test] PASS ${t.name}`);
      pass++;
    } catch (e) {
      console.warn(`[nookworks-test] FAIL ${t.name}: ${e}\n${e?.stack ?? ""}`);
      fail++;
    }
  }
  console.warn(`[nookworks-test] DONE ${pass} passed, ${fail} failed`);
}

system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id === "nookworks:test") runAll(e.message?.trim() || "all");
});

import "./tests.js";
