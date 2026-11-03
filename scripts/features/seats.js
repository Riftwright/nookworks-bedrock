// Chairs, stools and benches: right-click with an empty hand to sit (an invisible seat entity is ridden).
import { world, system } from "@minecraft/server";
import { onBlock } from "../lib/blocks.js";
import { held, safe, blockAt } from "../lib/util.js";
import { DATA } from "../generated/data.js";

const SEAT = "nookworks:seat";
const seatTop = (typeId) => (typeId.endsWith("_stool") ? 7 / 16 : typeId.endsWith("_bench") ? 8 / 16 : 9 / 16);
const SEATS = Object.keys(DATA.blockStates).filter((b) => /_(chair|stool|bench)$/.test(b));

onBlock(SEATS, {
  interact: ({ block, player }) => {
    if (held(player) || player.isSneaking) return;
    if (player.getComponent("minecraft:riding")) return;
    const c = block.center();
    const pos = { x: c.x, y: block.location.y + seatTop(block.typeId) - 0.15, z: c.z };
    const taken = block.dimension.getEntities({ type: SEAT, location: pos, maxDistance: 0.6 });
    for (const s of taken) {
      if (s.getComponent("minecraft:rideable")?.getRiders().length) return;
      s.remove();
    }
    const seat = block.dimension.spawnEntity(SEAT, pos);
    seat.getComponent("minecraft:rideable")?.addRider(player);
  },
  broken: ({ block, dim }) => {
    const c = { x: block.location.x + 0.5, y: block.location.y + 0.4, z: block.location.z + 0.5 };
    for (const s of dim.getEntities({ type: SEAT, location: c, maxDistance: 1 })) s.remove();
  },
});

// seats left empty, or whose furniture is gone, go away
system.runInterval(
  safe(() => {
    for (const dim of ["overworld", "nether", "the_end"].map((d) => world.getDimension(d))) {
      for (const s of dim.getEntities({ type: SEAT })) {
        const riders = s.getComponent("minecraft:rideable")?.getRiders() ?? [];
        const b = blockAt(dim, { x: Math.floor(s.location.x), y: Math.floor(s.location.y + 0.2), z: Math.floor(s.location.z) });
        if (!riders.length || !b || !SEATS.includes(b.typeId.slice(10))) s.remove();
      }
    }
  }, "seats"),
  20
);
