"""Java vanilla texture name -> vanilla Bedrock texture path (referenced by path, never copied)."""
import json, re
from paths import BEDROCK_TEX

MANUAL = {
    "block/oak_planks": "planks_oak", "block/spruce_planks": "planks_spruce", "block/birch_planks": "planks_birch",
    "block/jungle_planks": "planks_jungle", "block/acacia_planks": "planks_acacia", "block/dark_oak_planks": "planks_big_oak",
    "block/stone_bricks": "stonebrick", "block/nether_bricks": "nether_brick", "block/bricks": "brick",
    "block/smooth_stone": "stone_slab_top", "block/smooth_stone_slab_side": "stone_slab_side",
    "block/black_concrete": "concrete_black", "block/terracotta": "hardened_clay",
    "block/polished_andesite": "stone_andesite_smooth", "block/water_still": "water_still_grey",
    "block/anvil": "anvil_base", "block/redstone_torch": "redstone_torch_on",
    "block/poppy": "flower_rose", "block/dandelion": "flower_dandelion", "block/blue_orchid": "flower_blue_orchid",
    "block/allium": "flower_allium", "block/azure_bluet": "flower_houstonia", "block/red_tulip": "flower_tulip_red",
    "block/orange_tulip": "flower_tulip_orange", "block/white_tulip": "flower_tulip_white", "block/pink_tulip": "flower_tulip_pink",
    "block/oxeye_daisy": "flower_oxeye_daisy", "block/cornflower": "flower_cornflower",
    "block/lily_of_the_valley": "flower_lily_of_the_valley", "block/wither_rose": "flower_wither_rose",
    "block/oak_sapling": "sapling_oak", "block/spruce_sapling": "sapling_spruce", "block/birch_sapling": "sapling_birch",
    "block/jungle_sapling": "sapling_jungle", "block/acacia_sapling": "sapling_acacia", "block/dark_oak_sapling": "sapling_roofed_oak",
    "block/red_mushroom": "mushroom_red", "block/brown_mushroom": "mushroom_brown", "block/dead_bush": "deadbush",
    "block/bamboo_stalk": "bamboo_stem", "block/bamboo_singleleaf": "bamboo_singleleaf",
    "block/stripped_dark_oak_log": "stripped_dark_oak_log", "block/stripped_dark_oak_log_top": "stripped_dark_oak_log_top",
    "block/hopper_outside": "hopper_outside", "block/hopper_inside": "hopper_inside",
    "block/cobblestone": "cobblestone", "block/stone": "stone", "block/dirt": "dirt",
    "block/flower_pot": "flower_pot", "block/glow_lichen": "glow_lichen", "block/cut_copper": "cut_copper",
    "item/glass_bottle": "potion_bottle_empty", "item/bucket": "bucket_empty", "item/birch_boat": "boat_birch",
    "item/birch_chest_boat": "birch_chest_boat", "item/lantern": "lantern", "item/soul_lantern": "soul_lantern",
    "block/oak_log": "log_oak", "block/oak_log_top": "log_oak_top", "block/spruce_log": "log_spruce",
    "block/oak_leaves": "leaves_oak", "block/glass": "glass", "block/white_wool": "wool_colored_white",
    "block/iron_bars": "iron_bars", "block/open_eyeblossom": "eyeblossom_blooming", "block/closed_eyeblossom": "eyeblossom_dormant",
    "block/open_eyeblossom_emissive": "eyeblossom_eyes_blooming", "block/chain": "chain1", "block/iron_chain": "chain1",
}

_paths = None
def _index():
    global _paths
    if _paths is None:
        _paths = {}
        for p in json.load(open(BEDROCK_TEX)):
            if p.endswith("_mers") or p.endswith("_normal") or p.endswith("_heightmap"): continue
            b = p.split("/")[-1]
            pri = 0 if p.startswith("textures/blocks/") or p.startswith("textures/items/") else 1
            if b not in _paths or pri < _paths[b][0]:
                _paths[b] = (pri, p)
    return _paths

def resolve(java_name):
    """'block/oak_planks' -> 'textures/blocks/planks_oak' or None."""
    idx = _index()
    kind = "items" if java_name.startswith("item/") else "blocks"
    base = MANUAL.get(java_name, java_name.split("/", 1)[1])
    for cand in (base, base.replace("_", ""), base + "_side"):
        if f"textures/{kind}/{cand}" in set(p for _, p in idx.values()):
            return f"textures/{kind}/{cand}"
        if cand in idx:
            return idx[cand][1]
    # stripped / new woods: Bedrock keeps java names under blocks/ for most
    m = re.match(r"(block)/(.+)_(log|stem)(_top)?$", java_name)
    if m:
        alt = f"{m.group(2)}_{m.group(3)}{m.group(4) or ''}"
        if alt in idx: return idx[alt][1]
    return None
