// Blocks whose look depends on their neighbours (fences, desks, pipes, cables, chimneys...): their direction
// states are worked out again whenever a block next to them is placed or broken. Java does this in
// updateShape; Bedrock has no neighbour event for custom blocks, so placing/breaking stands in for it.
import { world, system } from "@minecraft/server";
import { DIRS, add, blockAt, setStates, id, safe } from "../lib/util.js";
import { onAnyBreak, onAnyPlace } from "../lib/blocks.js";

/** typeId -> (block, dir, neighbourBlock) => state value for that direction (true/false or a string) */
export const connectors = new Map();
/** typeId -> (block) => extra states to set, after the directions */
export const reshapers = new Map();

export function connects(names, fn, dirs = ["north", "east", "south", "west"], reshape) {
  for (const n of [].concat(names)) {
    connectors.set(id(n), { fn, dirs });
    if (reshape) reshapers.set(id(n), reshape);
  }
}

export function refresh(block) {
  if (!block) return;
  const c = connectors.get(block.typeId);
  if (c) {
    const st = {};
    for (const d of c.dirs) st[d] = c.fn(block, d, blockAt(block.dimension, add(block.location, DIRS[d])));
    setStates(block, st);
  }
  const r = reshapers.get(block.typeId);
  if (r) setStates(block, r(block));
}

function around(dim, pos) {
  // next tick: the broken block is gone and the placed one has its final state
  system.run(
    safe(() => {
      refresh(blockAt(dim, pos));
      for (const d of Object.values(DIRS)) refresh(blockAt(dim, add(pos, d)));
    }, "connect")
  );
}

onAnyPlace(({ block, dim }) => around(dim, block.location));
onAnyBreak(({ block, dim }) => around(dim, block.location));

/** For scripts that place or change blocks themselves. */
export function changed(block) {
  around(block.dimension, block.location);
}

// ---- common tests

export function solid(nb) {
  if (!nb || nb.isAir || nb.isLiquid) return false;
  try {
    return nb.isSolid ?? true;
  } catch {
    return true;
  }
}
