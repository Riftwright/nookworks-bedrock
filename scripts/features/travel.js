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
import { DIRS, OPPOSITE, add, blockAt, held, tr, actionbar, safe, setStates, state, isCreative, facing, randInt } from "../lib/util.js";

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
    doors[block.dimension.id] = { ...block.location };
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
    player.teleport({ x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 }, { dimension: dim });
    system.runTimeout(safe(() => buildReturnDoor(player, dim, base), "returnDoor"), 20);
    return;
  }
  const f = facing(blockAt(dim, d) ?? { permutation: { getState: () => "north" } });
  const out = add(d, DIRS[f]);
  player.teleport({ x: out.x + 0.5, y: out.y, z: out.z + 0.5 }, { dimension: dim });
  dim.playSound("mob.endermen.portal", out);
}

function buildReturnDoor(player, dim, base) {
  const doors = getJ("doors", {});
  if (doors[dim.id]) return;
  const p = { x: Math.floor(player.location.x) + 2, y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
  // a stone-brick frame with a floor, the door in its middle facing the player
  dim.runCommand(`fill ${p.x - 1} ${p.y - 1} ${p.z - 1} ${p.x + 1} ${p.y + 2} ${p.z + 1} stonebrick`);
  dim.runCommand(`fill ${p.x} ${p.y} ${p.z - 1} ${p.x} ${p.y + 1} ${p.z} air`);
  const lower = dim.getBlock(p);
  lower.setPermutation(BlockPermutation.resolve(DOOR, { "minecraft:cardinal_direction": "west", "nookworks:half": "lower" }));
  dim.getBlock(add(p, DIRS.up)).setPermutation(BlockPermutation.resolve(DOOR, { "minecraft:cardinal_direction": "west", "nookworks:half": "upper" }));
  doors[dim.id] = { ...p };
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
  player.setDynamicProperty("ifReturn", JSON.stringify({ dim: player.dimension.id, pos: { ...player.location } }));
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
      const p = { x: Math.floor(player.location.x) + 1, y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
      const b = blockAt(player.dimension, p), up = blockAt(player.dimension, add(p, DIRS.up));
      if (b?.isAir && up?.isAir) {
        b.setPermutation(BlockPermutation.resolve(IF, { "minecraft:cardinal_direction": "west", "nookworks:half": "lower" }));
        up.setPermutation(BlockPermutation.resolve(IF, { "minecraft:cardinal_direction": "west", "nookworks:half": "upper" }));
      }
    }, "if landing"),
    10
  );
}
