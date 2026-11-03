// Hub Stone, Nested Timer and Dice (docs/java_spec.md §9). Output goes through minecraft:redstone_producer, set by
// state in the block JSON (tools/behaviors.py REDSTONE_WHEN).
import { world, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { onBlock } from "../lib/blocks.js";
import * as store from "../lib/store.js";
import { DIRS, add, blockAt, held, tr, actionbar, safe, setStates, state, later, randInt } from "../lib/util.js";

// ---- Hub Stone: the strongest signal around it, a neighbouring hub stone counting one less, out to all six sides
onBlock("hub_stone", {
  tick: ({ block }) => {
    let p = 0;
    for (const d of Object.values(DIRS)) {
      const n = blockAt(block.dimension, add(block.location, d));
      if (!n || n.isAir) continue;
      if (n.typeId === "nookworks:hub_stone") p = Math.max(p, (state(n, "power") ?? 0) - 1);
      else if (n.typeId !== "minecraft:redstone_wire") p = Math.max(p, n.getRedstonePower() ?? 0);
    }
    setStates(block, { power: Math.max(0, Math.min(15, p)) });
  },
});

// ---- Nested Timer: every interval, `pulses` pulses of 2 ticks, `gap` apart; the meter shows the interval
const INTERVALS = [10, 20, 40, 60, 100, 200, 300, 400, 600, 900, 1200, 2400, 3600, 6000, 12000, 18000, 24000, 36000, 48000, 54000, 72000];
const GAPS = [10, 20, 40, 60, 100, 200, 300, 400, 600, 900, 1200];
function timerData(block) {
  return store.get(block, () => ({ interval: 1, pulses: 1, gap: 1, t: 0 }));
}
onBlock("nested_timer", {
  interact: ({ block, player }) => system.run(() => timerForm(block, player)),
  tick: ({ block }) => {
    const d = timerData(block);
    const iv = INTERVALS[d.interval];
    d.t = (d.t + 10) % iv;
    for (let i = 0; i < d.pulses; i++) {
      const at = i * GAPS[d.gap];
      if (at >= iv) break;
      if (d.t === at) {
        setStates(block, { powered: true });
        const dim = block.dimension, pos = block.location;
        later(2, () => {
          const b = blockAt(dim, pos);
          if (b?.typeId === "nookworks:nested_timer") setStates(b, { powered: false });
        });
      }
    }
    setStates(block, { interval: [20, 40, 100, 600, 6000].filter((x) => iv >= x).length });
    store.save(block);
  },
});
async function timerForm(block, player) {
  const d = timerData(block);
  const f = new ModalFormData().title({ rawtext: [tr("block.nookworks.nested_timer")] })
    .slider({ rawtext: [tr("nookworks.bedrock.timer_interval")] }, 0, INTERVALS.length - 1, { valueStep: 1, defaultValue: d.interval })
    .slider({ rawtext: [tr("nookworks.bedrock.timer_pulses")] }, 1, 10, { valueStep: 1, defaultValue: d.pulses })
    .slider({ rawtext: [tr("nookworks.bedrock.timer_gap")] }, 0, GAPS.length - 1, { valueStep: 1, defaultValue: d.gap });
  const r = await f.show(player);
  if (r.canceled) return;
  [d.interval, d.pulses, d.gap] = r.formValues.map(Number);
  d.t = 0;
  store.save(block);
  actionbar(player, { rawtext: [{ text: `${INTERVALS[d.interval] / 20}s × ${d.pulses} / ${GAPS[d.gap] / 20}s` }] });
}

// ---- Dice: a click rolls it (about a second), the face shown to everyone near; the Dice item rolls in the hand
function announce(dim, pos, v, who) {
  for (const p of dim.getPlayers({ location: pos, maxDistance: 16 }))
    p.onScreenDisplay.setActionBar({ rawtext: [tr("nookworks.bedrock.dice_rolled", who ?? "", ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][v] + ` ${v}`)] });
}
onBlock("dice", {
  interact: ({ block, player }) => {
    const v = randInt(1, 6);
    block.dimension.playSound("random.click", block.location, { pitch: 0.8 });
    const d = store.get(block, () => ({}));
    d.value = v;
    store.save(block);
    later(20, () => announce(block.dimension, block.center(), v, player.name));
  },
});
const lastRoll = new Map();
world.afterEvents.itemUse.subscribe(
  safe((e) => {
    if (e.itemStack.typeId !== "nookworks:dice") return;
    const p = e.source;
    if ((lastRoll.get(p.id) ?? 0) > system.currentTick - 20) return;
    lastRoll.set(p.id, system.currentTick);
    const v = randInt(1, 6);
    p.dimension.playSound("random.click", p.location, { pitch: 0.8 });
    later(16, () => announce(p.dimension, p.location, v, p.name));
  }, "dice item")
);
