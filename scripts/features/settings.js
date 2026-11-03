// Java's config (NookworksConfig), kept per world. Opened with /nookworks:settings (operators) or
// /scriptevent nookworks:settings.
import * as mc from "@minecraft/server";
const { world, system } = mc;
import { ModalFormData } from "@minecraft/server-ui";
import { safe } from "../lib/util.js";

const DEFAULTS = {
  timber: true, timberMax: 256, veinMining: true, veinMax: 64, hammer: true, magnet: true, buildingWand: true,
  protectTools: true, fastLeafDecay: true, machineEnergy: 1, machineTime: 1, generatorOutput: 1,
  elevatorRange: 64, itemWarpRange: 64, sifterTicks: 20, campfiresUnlit: true,
};
let cur = null;

export function setting(name) {
  if (!cur) {
    try {
      cur = { ...DEFAULTS, ...JSON.parse(world.getDynamicProperty("settings") ?? "{}") };
    } catch {
      cur = { ...DEFAULTS };
    }
  }
  return cur[name];
}

function saveSettings() {
  world.setDynamicProperty("settings", JSON.stringify(cur));
}

const BOOLS = ["timber", "veinMining", "hammer", "magnet", "buildingWand", "protectTools", "fastLeafDecay", "campfiresUnlit"];
const NUMS = [["timberMax", 1, 1024, 1], ["veinMax", 1, 512, 1], ["machineEnergy", 0.1, 10, 0.1], ["machineTime", 0.1, 10, 0.1],
  ["generatorOutput", 0.1, 10, 0.1], ["elevatorRange", 2, 384, 1], ["itemWarpRange", 2, 384, 1], ["sifterTicks", 1, 1200, 1]];

export async function openSettings(player) {
  setting("timber");
  const f = new ModalFormData().title({ rawtext: [{ translate: "nookworks.bedrock.settings" }] });
  for (const b of BOOLS) f.toggle({ rawtext: [{ translate: `nookworks.bedrock.setting.${b}` }] }, { defaultValue: !!cur[b] });
  for (const [n, lo, hi, step] of NUMS)
    f.slider({ rawtext: [{ translate: `nookworks.bedrock.setting.${n}` }] }, lo, hi, { valueStep: step, defaultValue: cur[n] });
  const r = await f.show(player);
  if (r.canceled || !r.formValues) return;
  let i = 0;
  for (const b of BOOLS) cur[b] = !!r.formValues[i++];
  for (const [n] of NUMS) cur[n] = Number(r.formValues[i++]);
  saveSettings();
}

system.afterEvents.scriptEventReceive.subscribe(
  safe((e) => {
    if (e.id === "nookworks:settings" && e.sourceEntity?.typeId === "minecraft:player") openSettings(e.sourceEntity);
  }, "settings event")
);

system.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.customCommandRegistry.registerCommand(
      { name: "nookworks:settings", description: "nookworks.bedrock.settings", permissionLevel: mc.CommandPermissionLevel?.GameDirectors ?? 1 },
      (origin) => {
        const p = origin.sourceEntity;
        if (p?.typeId === "minecraft:player") system.run(() => openSettings(p));
        return { status: mc.CustomCommandStatus?.Success ?? 0 };
      }
    );
  } catch (e) {
    console.warn("[nookworks] custom commands unavailable: " + e);
  }
});
