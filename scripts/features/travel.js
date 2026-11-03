// Dock-a-Daemon Door, Destination Panel, the If mirror (docs/java_spec.md §11).
// - One door per dimension (the first is home). The panel beside it picks, per player, where the door leads: the
//   dimensions the player has been to, and the If. Walking through the open doorway travels; the first trip to a
//   dimension without a door builds a return door near where the player last was there.
// - The If: Bedrock has no extra dimensions, so the If is a far part of the overworld picked by six dice (46,656
//   places), fresh ground to mine and build. Use a Die on the mirror six times, then an empty hand to go; a mirror
//   is set where you arrive, and an empty hand on it brings you home.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { onBlock } from "../lib/blocks.js";
import { DIRS, OPPOSITE, add, blockAt, held, tr, actionbar, safe, setStates, state, isCreative, facing, randInt, isSolidBlock } from "../lib/util.js";

const DOOR = "nookworks:daemon_door";
const DIM_KEYS = { "minecraft:overworld": "nookworks.bedrock.dim_overworld", "minecraft:nether": "nookworks.bedrock.dim_nether",
  "minecraft:the_end": "nookworks.bedrock.dim_end", if: "nookworks.bedrock.dim_if" };
const getJ = (k, d) => JSON.parse(world.getDynamicProperty(k) ?? JSON.stringify(d));
const setJ = (k, v) => world.setDynamicProperty(k, JSON.stringify(v));

// visited dimensions and last positions, per player
system.runInterval(
  safe(() => {
    for (const p of world.getAllPlayers()) {
      const v = JSON.parse(p.getDynamicProperty("visited") ?? "{}");
      v[p.dimension.id] = { x: Math.floor(p.location.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z) };
      p.setDynamicProperty("visited", JSON.stringify(v));
    }
  }, "visited"),
  100
);

// ---- the door: two blocks, opened together by a click
onBlock("daemon_door", {
  placedBy: ({ block, player }) => {
    const doors = getJ("doors", {});
    const above = blockAt(block.dimension, add(block.location, DIRS.up));
    if (doors[block.dimension.id] || !above?.isAir) {
      block.setType("minecraft:air");
      if (!isCreative(player)) block.dimension.spawnItem(new ItemStack(DOOR, 1), block.center());
      actionbar(player, tr("nookworks.bedrock.door_one_per_dim"));
      return;
    }
    setStates(block, { half: "lower" });
    above.setPermutation(block.permutation.withState("nookworks:half", "upper"));
    doors[block.dimension.id] = { ...block.location, f: state(block, "minecraft:cardinal_direction") ?? "north" };
    if (!getJ("homeDoor", null)) setJ("homeDoor", block.dimension.id);
    setJ("doors", doors);
  },
  interact: ({ block }) => {
    const lower = state(block, "half") === "upper" ? blockAt(block.dimension, add(block.location, DIRS.down)) : block;
    const open = !state(lower, "open");
    setStates(lower, { open });
    const up = blockAt(block.dimension, add(lower.location, DIRS.up));
    if (up?.typeId === DOOR) setStates(up, { open });
    block.dimension.playSound(open ? "open.iron_door" : "close.iron_door", block.location);
  },
  broken: ({ block, perm, dim }) => {
    const half = perm.getState("nookworks:half");
    const other = blockAt(dim, add(block.location, half === "lower" ? DIRS.up : DIRS.down));
    if (other?.typeId === DOOR) other.setType("minecraft:air");
    const doors = getJ("doors", {});
    const lowerY = half === "lower" ? block.location.y : block.location.y - 1;
    if (doors[dim.id] && doors[dim.id].x === block.location.x && doors[dim.id].y === lowerY && doors[dim.id].z === block.location.z) {
      delete doors[dim.id];
      setJ("doors", doors);
    }
  },
});

onBlock("destination_panel", {
  interact: ({ player }) => system.run(() => panelForm(player)),
});
async function panelForm(player) {
  const visited = Object.keys(JSON.parse(player.getDynamicProperty("visited") ?? "{}"));
  const choices = [...new Set(["minecraft:overworld", ...visited])].filter((d) => DIM_KEYS[d]);
  if (player.getDynamicProperty("ifNumber")) choices.push("if");
  const f = new ActionFormData().title({ rawtext: [tr("block.nookworks.destination_panel")] });
  const cur = player.getDynamicProperty("doorTarget");
  for (const c of choices) f.button({ rawtext: [{ text: c === cur ? "§2▶ " : "" }, tr(DIM_KEYS[c])] });
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  player.setDynamicProperty("doorTarget", choices[r.selection]);
}

// walking into an open doorway
const cooldown = new Map();
system.runInterval(
  safe(() => {
    const doors = getJ("doors", {});
    for (const p of world.getAllPlayers()) {
      if ((cooldown.get(p.id) ?? 0) > system.currentTick) continue;
      const here = doors[p.dimension.id];
      if (!here) continue;
      const l = p.location;
      if (Math.floor(l.x) !== here.x || Math.floor(l.z) !== here.z || Math.abs(Math.floor(l.y) - here.y) > 1) continue;
      const b = blockAt(p.dimension, here);
      if (!b || b.typeId !== DOOR || !state(b, "open")) continue;
      const target = p.getDynamicProperty("doorTarget") ?? "minecraft:overworld";
      if (target === p.dimension.id) continue;
      cooldown.set(p.id, system.currentTick + 40);
      travelTo(p, target);
    }
  }, "doors"),
  4
);

function travelTo(player, target) {
  if (target === "if") return goIf(player);
  const doors = getJ("doors", {});
  const dim = world.getDimension(target);
  let d = doors[target];
  if (!d) {
    // first trip: a return door near where the player last was there (or a sensible spot)
    const v = JSON.parse(player.getDynamicProperty("visited") ?? "{}")[target];
    const base = v ?? (target === "minecraft:the_end" ? { x: 100, y: 49, z: 0 } : { x: Math.floor(player.location.x / (target === "minecraft:nether" ? 8 : 1)), y: 64, z: Math.floor(player.location.z / (target === "minecraft:nether" ? 8 : 1)) });
    player.addEffect("resistance", 100, { amplifier: 4, showParticles: false });
    player.teleport({ x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 }, { dimension: dim });
    system.runTimeout(safe(() => {
      freeSpot(player, dim);
      buildReturnDoor(player, dim, base);
    }, "returnDoor"), 20);
    return;
  }
  // the far door's chunk is seldom loaded: its facing was kept when it was placed
  const f = d.f ?? (blockAt(dim, d) ? facing(blockAt(dim, d)) : "north");
  const out = add(d, DIRS[f]);
  player.teleport({ x: out.x + 0.5, y: out.y, z: out.z + 0.5 }, { dimension: dim });
  dim.playSound("mob.endermen.portal", out);
}

/** Out of rock: up to the first two free blocks above (the spot a first trip lands on may be inside the ground). */
function freeSpot(player, dim) {
  const l = player.location;
  for (let y = Math.floor(l.y); y < Math.min(dim.heightRange.max - 2, Math.floor(l.y) + 64); y++) {
    const a = blockAt(dim, { x: Math.floor(l.x), y, z: Math.floor(l.z) });
    const b = blockAt(dim, { x: Math.floor(l.x), y: y + 1, z: Math.floor(l.z) });
    if (a && b && !isSolidBlock(a) && !isSolidBlock(b) && !/lava/.test(a.typeId + b.typeId)) {
      if (y !== Math.floor(l.y)) player.teleport({ x: l.x, y, z: l.z });
      return;
    }
  }
}

function buildReturnDoor(player, dim, base) {
  const doors = getJ("doors", {});
  if (doors[dim.id]) return;
  // beside the player, where nothing with contents stands
  let p = null;
  for (let dx = 2; dx <= 6 && !p; dx++) {
    const q = { x: Math.floor(player.location.x) + dx, y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
    let ok = true;
    for (const [ax, ay, az] of [[0, 0, 0], [0, 1, 0], [0, 0, -1], [0, 1, -1]]) {
      const b = blockAt(dim, { x: q.x + ax, y: q.y + ay, z: q.z + az });
      if (!b) ok = false;
      else
        try {
          if (b.getComponent("minecraft:inventory") || b.typeId.startsWith("nookworks:")) ok = false;
        } catch {}
    }
    if (ok) p = q;
  }
  if (!p) return;
  // a stone-brick frame where there is air, the door in its middle facing north
  dim.runCommand(`fill ${p.x - 1} ${p.y - 1} ${p.z - 1} ${p.x + 1} ${p.y + 2} ${p.z + 1} stone_bricks keep`);
  // the frame open to the north, where the door faces and where travellers step out
  dim.runCommand(`fill ${p.x} ${p.y} ${p.z - 1} ${p.x} ${p.y + 1} ${p.z} air`);
  const lower = dim.getBlock(p);
  lower.setPermutation(BlockPermutation.resolve(DOOR, { "minecraft:cardinal_direction": "north", "nookworks:half": "lower" }));
  dim.getBlock(add(p, DIRS.up)).setPermutation(BlockPermutation.resolve(DOOR, { "minecraft:cardinal_direction": "north", "nookworks:half": "upper" }));
  doors[dim.id] = { ...p, f: "north" };
  setJ("doors", doors);
  player.setDynamicProperty("doorTarget", getJ("homeDoor", "minecraft:overworld"));
}

// ---- the If mirror
const IF = "nookworks:if_mirror";
onBlock("if_mirror", {
  placedBy: ({ block }) => {
    const above = blockAt(block.dimension, add(block.location, DIRS.up));
    setStates(block, { half: "lower" });
    if (above?.isAir) above.setPermutation(block.permutation.withState("nookworks:half", "upper"));
  },
  broken: ({ block, perm, dim }) => {
    const other = blockAt(dim, add(block.location, perm.getState("nookworks:half") === "lower" ? DIRS.up : DIRS.down));
    if (other?.typeId === IF) other.setType("minecraft:air");
  },
  interact: ({ block, player }) => {
    const h = held(player);
    if (h?.typeId === "nookworks:dice") {
      const faces = JSON.parse(player.getDynamicProperty("ifFaces") ?? "[]");
      faces.push(randInt(1, 6));
      if (faces.length >= 6) {
        const n = faces.slice(0, 6).reduce((s, f) => s * 6 + (f - 1), 0) + 1;
        player.setDynamicProperty("ifNumber", n);
        player.setDynamicProperty("ifFaces", "[]");
        actionbar(player, tr("nookworks.bedrock.if_set", n));
      } else {
        player.setDynamicProperty("ifFaces", JSON.stringify(faces));
        actionbar(player, { rawtext: [{ text: faces.map((f) => ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][f]).join(" ") }] });
      }
      return;
    }
    if (h) return;
    const ret = player.getDynamicProperty("ifReturn");
    if (ret && player.getDynamicProperty("inIf")) {
      const r = JSON.parse(ret);
      player.setDynamicProperty("inIf", false);
      cooldown.set(player.id, system.currentTick + 60);
      player.teleport(r.pos, { dimension: world.getDimension(r.dim) });
      return;
    }
    if (!player.getDynamicProperty("ifNumber")) return actionbar(player, tr("nookworks.bedrock.if_roll_first"));
    goIf(player, block);
  },
});

function ifPlace(n) {
  // spread over a ring 1,000,000 to 3,000,000 blocks out, as a hash of the number
  let h = n * 2654435761 % 4294967296;
  const ang = (h / 4294967296) * Math.PI * 2;
  h = (h * 1103515245 + 12345) % 2147483648;
  const r = 1000000 + (h / 2147483648) * 2000000;
  return { x: Math.round(Math.cos(ang) * r), z: Math.round(Math.sin(ang) * r) };
}

function goIf(player, fromBlock) {
  const n = player.getDynamicProperty("ifNumber");
  if (!n) return;
  let back = { ...player.location };
  if (!fromBlock) {
    // through a door: come back in front of it, not inside its doorway, and the door set to lead home again
    const door = getJ("doors", {})[player.dimension.id];
    const db = door && blockAt(player.dimension, door);
    if (door) {
      const out = add(door, DIRS[door.f ?? (db ? facing(db) : "north")]);
      back = { x: out.x + 0.5, y: out.y, z: out.z + 0.5 };
    }
    player.setDynamicProperty("doorTarget", getJ("homeDoor", "minecraft:overworld"));
  }
  player.setDynamicProperty("ifReturn", JSON.stringify({ dim: player.dimension.id, pos: back }));
  player.setDynamicProperty("inIf", true);
  const at = ifPlace(n);
  const ow = world.getDimension("overworld");
  player.addEffect("slow_falling", 600, { showParticles: false });
  player.addEffect("resistance", 600, { amplifier: 4, showParticles: false });
  player.teleport({ x: at.x + 0.5, y: 200, z: at.z + 0.5 }, { dimension: ow });
  // the mirror home is set where the player lands
  const job = system.runInterval(
    safe(() => {
      if (!player.isValid) return system.clearRun(job);
      if (!player.isOnGround) return;
      system.clearRun(job);
      player.removeEffect("slow_falling");
      // the mirror home: the nearest free two-high spot beside the player (a pillar of stone under it if need be)
      const o = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [1, 1], [-1, -1]]) {
        const p = { x: o.x + dx, y: o.y, z: o.z + dz };
        const b = blockAt(player.dimension, p), up = blockAt(player.dimension, add(p, DIRS.up));
        if (!b?.isAir || !up?.isAir) continue;
        const under = blockAt(player.dimension, add(p, DIRS.down));
        if (under?.isAir) under.setType("minecraft:stone");
        b.setPermutation(BlockPermutation.resolve(IF, { "minecraft:cardinal_direction": "west", "nookworks:half": "lower" }));
        up.setPermutation(BlockPermutation.resolve(IF, { "minecraft:cardinal_direction": "west", "nookworks:half": "upper" }));
        break;
      }
    }, "if landing"),
    10
  );
}
