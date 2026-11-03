"""Java item/block tags (ours, c:, and vanilla's) resolved to plain item lists."""
import json, re
from paths import JDATA, VANILLA_JAVA

class Tags:
    def __init__(self):
        self.files = {}
        for root in (VANILLA_JAVA / "data", JDATA):
            for f in root.glob("*/tags/*/**/*.json"):
                rel = f.relative_to(root)
                ns = rel.parts[0]
                kind = rel.parts[2]          # item / block / entity_type ...
                name = "/".join(rel.parts[3:])[:-5]
                key = (kind, f"{ns}:{name}")
                d = json.load(open(f, encoding="utf8"))
                vals = [v if isinstance(v, str) else v.get("id") for v in d.get("values", [])]
                if d.get("replace") or key not in self.files:
                    self.files[key] = list(vals)
                else:
                    self.files[key] += [v for v in vals if v not in self.files[key]]
        self.cache = {}

    # NeoForge's common tags, not in vanilla's data: what they hold in a plain game
    COMMON = {"c:barrels/wooden": ["minecraft:barrel"], "c:chests/wooden": ["minecraft:chest", "minecraft:trapped_chest"],
              "c:cobblestones/normal": ["minecraft:cobblestone"], "c:dusts/redstone": ["minecraft:redstone"],
              "c:eggs": ["minecraft:egg", "minecraft:blue_egg", "minecraft:brown_egg"],
              "c:glass_blocks/colorless": ["minecraft:glass"], "c:ingots/copper": ["minecraft:copper_ingot"],
              "c:ingots/iron": ["minecraft:iron_ingot"], "c:ingots/gold": ["minecraft:gold_ingot"],
              "c:nuggets/iron": ["minecraft:iron_nugget"], "c:nuggets/gold": ["minecraft:gold_nugget"],
              "c:rods/wooden": ["minecraft:stick"], "c:strings": ["minecraft:string"],
              "c:gems/diamond": ["minecraft:diamond"], "c:obsidians": ["minecraft:obsidian"],
              "c:leathers": ["minecraft:leather"], "c:slime_balls": ["minecraft:slime_ball"]}

    def items(self, tag, kind="item", seen=None):
        tag = tag if ":" in tag else "minecraft:" + tag
        k = (kind, tag)
        if k in self.cache:
            return self.cache[k]
        seen = seen or set()
        if k in seen:
            return []
        seen.add(k)
        out = []
        for v in self.files.get(k, []):
            if v.startswith("#"):
                out += [x for x in self.items(v[1:], kind, seen) if x not in out]
            elif v not in out:
                out.append(v if ":" in v else "minecraft:" + v)
        if not out and tag in self.COMMON:
            out = list(self.COMMON[tag])
        if not out and tag.startswith("c:dyes/"):
            out = [f"minecraft:{tag[7:]}_dye"]
        self.cache[k] = out
        return out

    def all_used(self, data):
        """Every '#tag' mentioned anywhere in the exported data, resolved (item tags, and block tags under 'block:')."""
        text = json.dumps(data)
        out = {}
        for t in set(re.findall(r'"#([a-z0-9_:/.\-]+)"', text)):
            out[t] = self.items(t)
        for (kind, t) in self.files:
            if kind == "block" and t.startswith(("minecraft:logs", "minecraft:leaves", "c:ores", "minecraft:mineable",
                                                   "minecraft:saplings", "minecraft:crops", "minecraft:flowers",
                                                   "nookworks:")):
                out["block:" + t] = self.items(t, "block")
            if kind == "item" and t.startswith("nookworks:"):
                out[t] = self.items(t)
        return out
