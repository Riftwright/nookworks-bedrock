"""Block properties read off the Java registry sources (hardness, light, collision, sound), by pattern.
Anything not found falls back to a default chosen from the block's name."""
import re
from paths import JSRC

HELPERS = {
    "machineProperties": dict(hardness=3.5, resistance=6, sound="metal"),
    "keeperProperties": dict(hardness=3.5, resistance=1200, sound="metal"),
    "metalProperties": dict(hardness=3.0, resistance=6, sound="metal"),
    "stoneProperties": dict(hardness=1.5, resistance=6, sound="stone"),
    "furniture": dict(hardness=2.0, resistance=3, sound="wood"),
    "sconceProperties": dict(hardness=0.5, resistance=0.5, sound="lantern", light=13),
    "wood(": dict(hardness=2.0, resistance=3, sound="wood"),
}
SOUNDS = {"WOOD": "wood", "METAL": "metal", "IRON": "metal", "STONE": "stone", "GLASS": "glass", "WOOL": "cloth",
          "GRAVEL": "gravel", "GRASS": "grass", "CROP": "grass", "SAND": "sand", "COPPER": "copper", "LANTERN": "lantern",
          "NETHERITE_BLOCK": "netherite", "CHAIN": "chain", "BAMBOO": "bamboo", "CHERRY_WOOD": "cherry_wood",
          "DECORATED_POT": "decorated_pot", "CHISELED_BOOKSHELF": "chiseled_bookshelf", "NETHERRACK": "netherrack",
          "MUD": "mud", "ROOTED_DIRT": "gravel", "SLIME_BLOCK": "slime", "CANDLE": "candle", "HONEY_BLOCK": "honey_block",
          "AMETHYST": "amethyst_block", "SCAFFOLDING": "scaffolding", "LADDER": "ladder", "ANVIL": "anvil"}

_cache = None

def scan():
    global _cache
    if _cache is not None:
        return _cache
    out = {}
    consts = {}
    for f in JSRC.rglob("*.java"):
        t = f.read_text(encoding="utf8")
        for m in re.finditer(r"public static final int LIGHT_LEVEL = (\d+)", t):
            consts[f.stem] = int(m.group(1))
    for f in (JSRC / "registry").glob("*.java"):
        t = f.read_text(encoding="utf8")
        for m in re.finditer(r'register(?:Simple)?Block\(\s*"([a-z0-9_]+)"', t):
            bid = m.group(1)
            end = t.find("public static final", m.end())
            seg = t[m.end(): end if end > 0 else m.end() + 600][:900]
            p = {}
            for h, v in HELPERS.items():
                if h in seg:
                    p.update(v)
            s = re.search(r"strength\(([\d.\-]+)F?(?:,\s*([\w.\-]+)F?)?\)", seg)
            if s:
                p["hardness"] = float(s.group(1))
                if s.group(2):
                    try:
                        p["resistance"] = float(s.group(2).rstrip("F"))
                    except ValueError:
                        p["resistance"] = 1200
                else:
                    p["resistance"] = p["hardness"]
            if "instabreak()" in seg:
                p["hardness"] = 0
            if "noCollision()" in seg:
                p["collision"] = False
            snd = re.search(r"SoundType\.(\w+)", seg)
            if snd:
                p["sound"] = SOUNDS.get(snd.group(1), "stone")
            lv = re.search(r"lightLevel\(\s*\w+\s*->\s*(\d+)\)", seg)
            if lv:
                p["light"] = int(lv.group(1))
            lv = re.search(r"lightLevel\(\s*\w+\s*->\s*\w+\.getValue\((\w+)\.(\w+)\)\s*\?\s*([\w.]+)", seg)
            if lv:
                cls, prop, val = lv.groups()
                p["light_when"] = prop.lower()
                p["light"] = int(val) if val.isdigit() else consts.get(cls, 13)
            if "requiresCorrectToolForDrops" in seg:
                p["needs_tool"] = True
            if "noLootTable()" in seg:
                p["no_loot"] = True
            out.setdefault(bid, p)
    _cache = out
    return out

WOODS = ("oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak", "bamboo",
         "crimson", "warped", "poplar", "dawnwood")

def props(bid):
    p = dict(hardness=1.5, resistance=6, sound="stone")
    if any(bid.startswith(w + "_") for w in WOODS) or "wood" in bid or "crate" in bid:
        p.update(hardness=2.0, resistance=3, sound="wood")
    if any(k in bid for k in ("lantern", "sconce")):
        p.update(hardness=0.5, resistance=0.5, sound="lantern")
    if any(k in bid for k in ("crop", "seedling", "corn", "onion", "rice", "sapling", "flower", "plant", "seed")):
        p.update(hardness=0, resistance=0, sound="grass", collision=False)
    p.update(scan().get(bid, {}))
    return p
