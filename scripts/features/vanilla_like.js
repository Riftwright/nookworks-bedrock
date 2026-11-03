// Dawnwood's door, trapdoor, fence gate, button, pressure plate, fence, slab and stairs: what vanilla's own do.
import { ItemStack, world } from "@minecraft/server";
import { onBlock, onItemTap, onAnyBreak } from "../lib/blocks.js";
import { DIRS, OPPOSITE, add, blockAt, setStates, state, id, held, consumeHeld, later, isCreative } from "../lib/util.js";
import { connects, solid, refresh } from "./connect.js";

const W = "dawnwood";
const sound = (block, s) => {
  // an Oil Can silences it (items2.js marks it)
  if (world.getDynamicProperty(`oil|${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`)) return;
  block.dimension.playSound(s, block.location);
};

// ---- two-high blocks: one item for the pair (the halves' own loot is empty)
const TWO_HIGH = new Set(["nookworks:dawnwood_door", "nookworks:daemon_door", "nookworks:if_mirror", "nookworks:standing_mirror", "nookworks:recycler"]);
onAnyBreak(({ block, dim, perm, player, typeId, explosion }) => {
  if (!TWO_HIGH.has(typeId) || (player && isCreative(player))) return;
  if (explosion && perm.getState("nookworks:half") === "upper") return; // a blast takes both: the lower half drops it
  dim.spawnItem(new ItemStack(typeId, 1), block.center());
});
world.afterEvents.blockExplode.subscribe((e) => {
  const t = e.explodedBlockPermutation.type.id;
  if (TWO_HIGH.has(t) && e.explodedBlockPermutation.getState("nookworks:half") !== "upper") e.dimension.spawnItem(new ItemStack(t, 1), e.block.center());
});

// ---- door: two blocks, opened together
onBlock(`${W}_door`, {
  placedBy: ({ block, player }) => {
    const above = blockAt(block.dimension, add(block.location, DIRS.up));
    if (!above || !above.isAir) {
      block.setType("minecraft:air");
      if (!isCreative(player)) block.dimension.spawnItem(new ItemStack(id(`${W}_door`), 1), block.location);
      return;
    }
    // hinge on the side with a door or block beside it, as vanilla judges it roughly
    const f = state(block, "minecraft:cardinal_direction");
    const left = { north: "west", south: "east", east: "north", west: "south" }[f];
    const nb = blockAt(block.dimension, add(block.location, DIRS[left]));
    const hinge = nb?.typeId === block.typeId ? "right" : "left";
    setStates(block, { half: "lower", hinge });
    above.setPermutation(block.permutation.withState("nookworks:half", "upper"));
  },
  interact: ({ block }) => toggleDoor(block),
  broken: ({ block, perm }) => {
    const half = perm.getState("nookworks:half");
    const other = blockAt(block.dimension, add(block.location, half === "lower" ? DIRS.up : DIRS.down));
    if (other?.typeId === id(`${W}_door`)) other.setType("minecraft:air");
  },
});

function toggleDoor(block) {
  const open = !state(block, "open");
  setStates(block, { open });
  const half = state(block, "half");
  const other = blockAt(block.dimension, add(block.location, half === "lower" ? DIRS.up : DIRS.down));
  if (other?.typeId === block.typeId) setStates(other, { open });
  sound(block, open ? "open.wooden_door" : "close.wooden_door");
}

onBlock(`${W}_trapdoor`, {
  interact: ({ block }) => {
    const open = !state(block, "open");
    setStates(block, { open });
    sound(block, open ? "open.wooden_trapdoor" : "close.wooden_trapdoor");
  },
});

onBlock(`${W}_fence_gate`, {
  interact: ({ block, player }) => {
    const open = !state(block, "open");
    // opens away from the player, as vanilla's does
    if (open) {
      const f = state(block, "minecraft:cardinal_direction");
      const v = player.getViewDirection();
      const away = Math.abs(v.x) > Math.abs(v.z) ? (v.x > 0 ? "east" : "west") : v.z > 0 ? "south" : "north";
      if (away === OPPOSITE[f]) setStates(block, { "minecraft:cardinal_direction": away });
    }
    setStates(block, { open });
    sound(block, open ? "open.fence_gate" : "close.fence_gate");
  },
});

onBlock(`${W}_button`, {
  placedBy: ({ block, player }) => {
    // floor / wall / ceiling from where it was put: a block under it means floor
    const below = blockAt(block.dimension, add(block.location, DIRS.down));
    const above = blockAt(block.dimension, add(block.location, DIRS.up));
    const f = state(block, "minecraft:cardinal_direction");
    const behind = blockAt(block.dimension, add(block.location, DIRS[OPPOSITE[f]]));
    const face = solid(behind) ? "wall" : solid(below) ? "floor" : solid(above) ? "ceiling" : "floor";
    setStates(block, { face });
  },
  interact: ({ block }) => {
    if (state(block, "powered")) return;
    press(block, 30);
  },
});

function press(block, ticks) {
  setStates(block, { powered: true });
  sound(block, "click_on.wooden_button");
  const dim = block.dimension, pos = block.location, t = block.typeId;
  // a redstone pulse: a powered block put in for the press's length, taken out after
  later(ticks, () => {
    const b = blockAt(dim, pos);
    if (b?.typeId === t) {
      setStates(b, { powered: false });
      dim.playSound("click_off.wooden_button", pos);
    }
  });
}

onBlock(`${W}_pressure_plate`, {
  stepOn: ({ block }) => {
    if (state(block, "powered")) return;
    setStates(block, { powered: true });
    sound(block, "click_on.wooden_pressure_plate");
    const dim = block.dimension, pos = block.location, t = block.typeId;
    const check = () => {
      const b = blockAt(dim, pos);
      if (b?.typeId !== t) return;
      const ents = dim.getEntities({ location: { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 }, maxDistance: 0.9 });
      if (ents.length) later(20, check);
      else {
        setStates(b, { powered: false });
        dim.playSound("click_off.wooden_pressure_plate", pos);
      }
    };
    later(20, check);
  },
});

// ---- fence: joins fences, gates and solid blocks
const FENCES = (nb) => nb && (nb.typeId.endsWith("_fence") || nb.typeId.endsWith("fence_gate") || nb.typeId === "minecraft:fence");
connects(`${W}_fence`, (b, d, nb) => FENCES(nb) || solid(nb));

// ---- slab: a second slab on a slab makes it whole
onItemTap(`${W}_slab`, (s) => s.typeId === `nookworks:${W}_slab`);
onBlock(`${W}_slab`, {
  interact: ({ block, player, face }) => {
    const h = held(player);
    if (h?.typeId !== block.typeId || state(block, "type") === "double") return;
    const t = state(block, "type");
    if ((t === "bottom" && face === "Up") || (t === "top" && face === "Down")) {
      setStates(block, { type: "double" });
      consumeHeld(player);
      sound(block, "use.wood");
    }
  },
  placedBy: ({ block, player }) => {
    // top or bottom by where on the face it was put (no vertical_half trait on a 3-way slab): look at the player
    const eye = player.getHeadLocation();
    const top = player.getViewDirection().y > 0.2 && eye.y < block.location.y + 0.5;
    setStates(block, { type: top ? "top" : "bottom" });
  },
});

// ---- stairs: corner shapes from the neighbours, as vanilla's StairBlock works them out
connects(`${W}_stairs`, () => undefined, [], (b) => ({ shape: stairShape(b) }));

const LEFT = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT = { north: "east", east: "south", south: "west", west: "north" };
function stairShape(b) {
  const f = state(b, "minecraft:cardinal_direction");
  const half = state(b, "minecraft:vertical_half");
  const isStair = (x) => x && x.typeId === b.typeId && state(x, "minecraft:vertical_half") === half;
  const front = blockAt(b.dimension, add(b.location, DIRS[f]));
  if (isStair(front)) {
    const ff = state(front, "minecraft:cardinal_direction");
    if (ff === LEFT[f]) return "outer_left";
    if (ff === RIGHT[f]) return "outer_right";
  }
  const back = blockAt(b.dimension, add(b.location, DIRS[OPPOSITE[f]]));
  if (isStair(back)) {
    const bf = state(back, "minecraft:cardinal_direction");
    if (bf === LEFT[f]) return "inner_left";
    if (bf === RIGHT[f]) return "inner_right";
  }
  return "straight";
}
