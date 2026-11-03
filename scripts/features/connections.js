// Which of our connecting blocks join which neighbours (states north/east/south/west/up/down, port_<dir>).
import { connects, solid } from "./connect.js";
import { holders, CABLE } from "../lib/energy.js";
import { fluidHolders, PIPES } from "../lib/fluids.js";
import { DATA } from "../generated/data.js";

const SIX = ["north", "east", "south", "west", "up", "down"];
const has = (nb, ...ids) => nb && ids.includes(nb.typeId);

connects("energy_cable", (b, d, nb) => !!nb && (nb.typeId === CABLE || holders.has(nb.typeId)), SIX);
connects("copper_pipe", (b, d, nb) => !!nb && (has(nb, "nookworks:copper_pipe", "nookworks:valve", "nookworks:sight_glass") || fluidHolders.has(nb.typeId)), SIX);
connects("experience_pipe", (b, d, nb) => !!nb && (nb.typeId === "nookworks:experience_pipe" || ["nookworks:experience_tank", "nookworks:absorption_pad", "nookworks:repair_box", "nookworks:electric_furnace", "nookworks:retort"].includes(nb.typeId)), SIX);
connects("mercury_pipe", (b, d, nb) => !!nb && (nb.typeId === "nookworks:mercury_pipe" || ["nookworks:mercury_tank", "nookworks:retort", "nookworks:stirring_tank", "nookworks:distiller", "nookworks:electrolytic_cell"].includes(nb.typeId)), SIX);
connects("duct", (b, d, nb) => !!nb && (nb.typeId === "nookworks:duct" || nb.typeId === "nookworks:ventilation_fan" || nb.typeId === "nookworks:barter_terminal" || nb.typeId.endsWith("_flue")), SIX);
connects("absorption_pad", (b, d, nb) => !!nb && nb.typeId === "nookworks:experience_pipe", ["north", "east", "south", "west", "up"]);

// desks join their own kind on four sides
const desks = Object.keys(DATA.blockStates).filter((k) => k.endsWith("_desk"));
connects(desks, (b, d, nb) => !!nb && nb.typeId === b.typeId);

// chimneys: a top when nothing of the stack is above
for (const c of ["chimney", "stone_brick_chimney", "nether_brick_chimney", "cobblestone_chimney"])
  connects(c, (b, d, nb) => !!nb && nb.typeId.endsWith("chimney"), ["north", "east", "south", "west"],
    (b) => ({ top: !b.above()?.typeId.endsWith("chimney") }));

// machine pipe flanges: a port where a pipe of either kind meets it
const ported = Object.entries(DATA.blockStates).filter(([, v]) => Object.keys(v.props).some((p) => p.startsWith("port_"))).map(([k, v]) => [k, Object.keys(v.props).filter((p) => p.startsWith("port_"))]);
for (const [b, ports] of ported) {
  const dirs = ports.map((p) => p.slice(5));
  connects(b, () => undefined, [], (blk) => {
    const out = {};
    for (const d of dirs) {
      const nb = blk.dimension.getBlock({ x: blk.location.x + ({ east: 1, west: -1 }[d] ?? 0), y: blk.location.y + ({ up: 1, down: -1 }[d] ?? 0), z: blk.location.z + ({ south: 1, north: -1 }[d] ?? 0) });
      out[`port_${d}`] = !!nb && (PIPES.has(nb.typeId) || nb.typeId === CABLE);
    }
    return out;
  });
}
