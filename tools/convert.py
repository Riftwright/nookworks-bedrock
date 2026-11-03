"""Build packs/nookworks_bp and packs/nookworks_rp from the Java mod's resources.

    python tools/fetch_refs.py   # once: reference data from local installs into .cache/
    python tools/convert.py      # regenerate every generated file

Hand-written parts live outside the generated folders: scripts/ (the Script API code), and src_packs/ (entities,
UI and any JSON written by hand), both copied in on top."""
import json, re, shutil, uuid
from paths import *
import convert_blocks, convert_items, java_tags, tool_items, convert_posters

VERSION = [1, 0, 1]
MIN_ENGINE = [1, 26, 60]
SERVER_VERSION = "2.11.0"     # @minecraft/server, stable
SERVER_UI_VERSION = "2.3.0"   # @minecraft/server-ui, stable

LANGS = {"en_us": "en_US", "ja_jp": "ja_JP", "zh_cn": "zh_CN", "zh_tw": "zh_TW", "ko_kr": "ko_KR", "es_es": "es_ES",
         "es_mx": "es_MX", "ru_ru": "ru_RU", "pt_br": "pt_BR", "pt_pt": "pt_PT"}

# Java item id -> Bedrock item id, where they differ
RENAMES = {
    "minecraft:dandelion": "minecraft:yellow_flower", "minecraft:terracotta": "minecraft:hardened_clay",
    "minecraft:bricks": "minecraft:brick_block", "minecraft:nether_bricks": "minecraft:nether_brick",
    "minecraft:nether_brick": "minecraft:netherbrick", "minecraft:lily_pad": "minecraft:waterlily",
    "minecraft:magma_block": "minecraft:magma", "minecraft:note_block": "minecraft:noteblock",
    "minecraft:dirt_path": "minecraft:grass_path", "minecraft:spawner": "minecraft:mob_spawner",
    "minecraft:end_stone_bricks": "minecraft:end_bricks", "minecraft:cobweb": "minecraft:web",
    "minecraft:jack_o_lantern": "minecraft:lit_pumpkin", "minecraft:melon": "minecraft:melon_block",
    "minecraft:powered_rail": "minecraft:golden_rail", "minecraft:map": "minecraft:empty_map",
    "minecraft:slime_block": "minecraft:slime", "minecraft:snow_block": "minecraft:snow",
    "minecraft:sugar_cane": "minecraft:sugar_cane", "minecraft:melon_slice": "minecraft:melon_slice",
    "minecraft:experience_bottle": "minecraft:experience_bottle", "minecraft:chain": "minecraft:iron_chain",
    "minecraft:nether_quartz_ore": "minecraft:quartz_ore", "minecraft:redstone_lamp": "minecraft:redstone_lamp",
    "minecraft:carrot": "minecraft:carrot", "minecraft:wheat_seeds": "minecraft:wheat_seeds",
    "minecraft:clock": "minecraft:clock", "minecraft:sweet_berries": "minecraft:sweet_berries",
    "minecraft:sign": "minecraft:oak_sign", "minecraft:oak_sign": "minecraft:oak_sign",
    "minecraft:dried_kelp_block": "minecraft:dried_kelp_block", "minecraft:enchanting_table": "minecraft:enchanting_table",
    "minecraft:stone_slab": "minecraft:normal_stone_slab", "minecraft:smooth_stone_slab": "minecraft:smooth_stone_slab",
    "minecraft:rose_bush": "minecraft:rose_bush", "minecraft:scute": "minecraft:turtle_scute",
    "minecraft:glow_item_frame": "minecraft:glow_frame", "minecraft:item_frame": "minecraft:frame",
    "minecraft:shulker_box": "minecraft:undyed_shulker_box", "minecraft:zombified_piglin_spawn_egg": "minecraft:zombie_pigman_spawn_egg",
    "minecraft:mooshroom_spawn_egg": "minecraft:mooshroom_spawn_egg",
    "minecraft:flowering_azalea_leaves": "minecraft:azalea_leaves_flowered",
    "minecraft:light_gray_glazed_terracotta": "minecraft:silver_glazed_terracotta", "minecraft:fire": "minecraft:fire",
}

_KNOWN = None
UNKNOWN = set()
def bid(jid):
    """Java id -> Bedrock id; vanilla ids are checked against tools/bedrock_items.txt (dumped from a BDS run)."""
    global _KNOWN
    jid = jid if ":" in jid else "minecraft:" + jid
    out = RENAMES.get(jid, jid)
    if out.startswith("minecraft:"):
        if _KNOWN is None:
            f = ROOT / "tools/bedrock_items.txt"
            _KNOWN = set(f.read_text().split()) if f.exists() else set()
        if _KNOWN and out not in _KNOWN:
            for alt in (jid, out.replace("oak_", "") if out.startswith("minecraft:oak_") else None):
                if alt and alt in _KNOWN:
                    return alt
            UNKNOWN.add(out)
    return out

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf8")

# crops: water-holding rice, and items that plant them only on farmland
CROP_BLOCKS = {
    "rice": {"minecraft:liquid_detection": {"detection_rules": [{"liquid_type": "water", "can_contain_liquid": True, "on_liquid_touches": "no_reaction"}]}},
}
PLANTS_ON = {"corn_kernels": ["minecraft:farmland", "nookworks:nourished_soil"], "onion": ["minecraft:farmland", "nookworks:nourished_soil"],
             "sunflower_seeds": ["minecraft:farmland", "nookworks:nourished_soil"], "end_seed": ["minecraft:farmland", "nookworks:nourished_soil", "minecraft:dirt", "minecraft:grass_block"],
             "brown_rice": ["minecraft:dirt", "minecraft:grass_block", "minecraft:farmland", "minecraft:mud", "minecraft:clay", "nookworks:nourished_soil"]}

def stable_uuid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "nookworks-bedrock/" + name))

def manifests():
    bp = {"format_version": 2, "header": {
        "name": "Nookworks", "description": "Nookworks (behaviour)", "uuid": stable_uuid("bp"), "version": VERSION,
        "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "data", "uuid": stable_uuid("bp-data"), "version": VERSION},
                    {"type": "script", "language": "javascript", "uuid": stable_uuid("bp-script"), "version": VERSION,
                     "entry": "scripts/main.js"}],
        "dependencies": [{"module_name": "@minecraft/server", "version": SERVER_VERSION},
                         {"module_name": "@minecraft/server-ui", "version": SERVER_UI_VERSION},
                         {"uuid": stable_uuid("rp"), "version": VERSION}],
        "metadata": {"authors": ["Riftwright"], "license": "MIT"}}
    rp = {"format_version": 2, "header": {
        "name": "Nookworks Resources", "description": "Nookworks (resources)", "uuid": stable_uuid("rp"), "version": VERSION,
        "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": stable_uuid("rp-res"), "version": VERSION}],
        "dependencies": [{"uuid": stable_uuid("bp"), "version": VERSION}],
        "metadata": {"authors": ["Riftwright"], "license": "MIT"}}
    write_json(BP / "manifest.json", bp)
    write_json(RP / "manifest.json", rp)

LANG_ADD = {}   # key -> (part key, part key): written as "<part1>: <part2>" in every language

def lang():
    keys = set()
    texts = {}
    for jl, bl in LANGS.items():
        f = JASSETS / "lang" / f"{jl}.json"
        if not f.exists():
            continue
        d = json.load(open(f, encoding="utf8"))
        extra = ROOT / "src_packs/lang" / f"{jl}.json"
        if extra.exists():
            d.update(json.load(open(extra, encoding="utf8")))
        texts[bl] = d
        keys |= set(d)
    en = texts["en_US"]
    for bl, d in texts.items():
        merged = dict(en); merged.update(d)
        for k, (a, b) in LANG_ADD.items():
            merged[k] = f"{merged.get(a, a)}: {merged.get(b, b)}"
        lines = []
        for k, v in merged.items():
            v = v.replace("\r", "").replace("\n", "~LINEBREAK~").replace("\t", " ")
            lines.append(f"{k}={v}")
        name = {"en_US": "Nookworks", "ja_JP": "Nookworks"}.get(bl, "Nookworks")
        desc = merged.get("nookworks.bedrock.pack_description", "Nookworks for Bedrock")
        for pack in (BP, RP):
            out = pack / "texts" / f"{bl}.lang"
            out.parent.mkdir(parents=True, exist_ok=True)
            extra = [f"pack.name={name}", f"pack.description={desc}"]
            out.write_text("\n".join(extra + (lines if pack is RP else [])) + "\n", encoding="utf8")
    for pack in (BP, RP):
        write_json(pack / "texts/languages.json", list(texts))
    return keys

# ---------------------------------------------------------------- recipes

BEDROCK_TAGS = {"minecraft:planks": "minecraft:planks", "minecraft:logs": "minecraft:logs",
                "minecraft:wool": "minecraft:wool", "minecraft:coals": "minecraft:coals",
                "minecraft:wooden_slabs": "minecraft:wooden_slabs",
                "minecraft:stone_crafting_materials": "minecraft:stone_crafting_materials",
                "minecraft:stone_tool_materials": "minecraft:stone_tool_materials",
                "minecraft:logs_that_burn": "minecraft:logs_that_burn"}

def ingredient_options(ing, tags):
    """Java ingredient -> list of Bedrock ingredient dicts (alternatives)."""
    if isinstance(ing, list):
        out = []
        for x in ing:
            out += ingredient_options(x, tags)
        return out
    if isinstance(ing, dict):
        ing = ing.get("item") or ing.get("items") or ing.get("ingredient") or ("#" + ing["tag"] if "tag" in ing else None)
        if isinstance(ing, (list, dict)):
            return ingredient_options(ing, tags)
    if ing.startswith("#"):
        t = ing[1:]
        if t in BEDROCK_TAGS:
            return [{"tag": BEDROCK_TAGS[t]}]
        items = tags.items(t)
        if not items:
            EMPTY_TAGS.add(t)
        return [{"item": bid(i)} for i in items] or [{"item": "minecraft:barrier"}]
    return [{"item": bid(ing)}]

def expand(slots, limit=24):
    """slots: {name: [options]} -> list of {name: option} combinations (capped)."""
    combos = [{}]
    for k, opts in slots.items():
        nxt = []
        for c in combos:
            for o in opts:
                d = dict(c); d[k] = o
                nxt.append(d)
                if len(nxt) >= limit:
                    break
            if len(nxt) >= limit:
                break
        combos = nxt
    return combos

def result_of(r):
    res = r["result"]
    if isinstance(res, str):
        return {"item": bid(res)}
    out = {"item": bid(res["id"])}
    if res.get("count", 1) != 1:
        out["count"] = res["count"]
    return out

STACK_ONE = set()
EMPTY_TAGS = set()

def convert_recipes(tags):
    out_dir = BP / "recipes"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    machine = {}
    n = 0
    files = sorted((JDATA / "nookworks/recipe").rglob("*.json"))
    for f in files:
        r = json.load(open(f, encoding="utf8"))
        name = str(f.relative_to(JDATA / "nookworks/recipe")).replace("\\", "/")[:-5].replace("/", "_")
        t = r["type"].replace("minecraft:", "").replace("nookworks:heating", "smelting").replace("nookworks:blast_heating", "blasting")
        rid = f"nookworks:{name}"
        recs = []
        if t == "crafting_shaped":
            slots = {k: ingredient_options(v, tags) for k, v in r["key"].items()}
            for i, combo in enumerate(expand(slots)):
                recs.append({"minecraft:recipe_shaped": {
                    "description": {"identifier": rid + (f"_{i}" if i else "")}, "tags": ["crafting_table"],
                    "pattern": r["pattern"], "key": combo, "result": result_of(r)}})
        elif t == "crafting_shapeless":
            slots = {str(i): ingredient_options(v, tags) for i, v in enumerate(r["ingredients"])}
            for i, combo in enumerate(expand(slots)):
                recs.append({"minecraft:recipe_shapeless": {
                    "description": {"identifier": rid + (f"_{i}" if i else "")}, "tags": ["crafting_table"],
                    "ingredients": list(combo.values()), "result": result_of(r)}})
        elif t == "crafting_transmute":
            slots = {"a": ingredient_options(r["input"], tags), "b": ingredient_options(r["material"], tags)}
            for i, combo in enumerate(expand(slots)):
                recs.append({"minecraft:recipe_shapeless": {
                    "description": {"identifier": rid + (f"_{i}" if i else "")}, "tags": ["crafting_table"],
                    "ingredients": [combo["a"], combo["b"]], "result": result_of(r)}})
        elif t in ("smelting", "blasting", "smoking", "campfire_cooking"):
            tag = {"smelting": ["furnace"], "blasting": ["blast_furnace"], "smoking": ["smoker"],
                   "campfire_cooking": ["campfire", "soul_campfire"]}[t]
            if t == "smelting" and re.search(r"food|meat|fish|egg|corn|potato|rice", json.dumps(r)):
                tag = ["furnace", "smoker"]
            for i, o in enumerate(ingredient_options(r["ingredient"], tags)):
                recs.append({"minecraft:recipe_furnace": {
                    "description": {"identifier": rid + (f"_{i}" if i else "")}, "tags": tag,
                    "input": o, "output": result_of(r)["item"]}})
        elif t == "stonecutting":
            for i, o in enumerate(ingredient_options(r["ingredient"], tags)):
                recs.append({"minecraft:recipe_shapeless": {
                    "description": {"identifier": rid + (f"_{i}" if i else "")}, "tags": ["stonecutter"],
                    "ingredients": [o], "result": result_of(r)}})
        elif t == "smithing_transform" and not re.search(r"(hammer|sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$", r["base"]):
            # Bedrock's smithing table takes only gear: the rest is made at a crafting table from the same three
            recs.append({"minecraft:recipe_shapeless": {
                "description": {"identifier": rid}, "tags": ["crafting_table"],
                "ingredients": [{"item": bid(r["template"])}, {"item": bid(r["base"])}, ingredient_options(r["addition"], tags)[0]],
                "result": result_of(r)}})
        elif t == "smithing_transform":
            recs.append({"minecraft:recipe_smithing_transform": {
                "description": {"identifier": rid}, "tags": ["smithing_table"],
                "template": bid(r["template"]), "base": bid(r["base"]),
                "addition": ingredient_options(r["addition"], tags)[0].get("item", "minecraft:netherite_ingot"),
                "result": result_of(r)["item"]}})
        else:
            machine[name] = r          # nookworks:pot / heating / ... : handled by scripts
            continue
        for rec in recs:
            body = next(iter(rec.values()))
            if "recipe_shaped" in next(iter(rec)) or "recipe_shapeless" in next(iter(rec)):
                body["unlock"] = {"context": "AlwaysUnlocked"}
                res = body.get("result", {})
                if isinstance(res, dict) and res.get("item") in STACK_ONE:
                    res.pop("count", None)
        for i, rec in enumerate(recs):
            write_json(out_dir / f"{name}{'_' + str(i) if i else ''}.json", {"format_version": "1.21.60", **rec})
            n += 1
    return machine, n

# ---------------------------------------------------------------- loot

def simple_self_drop(lt, block):
    """True when a Java block loot table only drops the block itself (the Bedrock default)."""
    pools = lt.get("pools", [])
    if len(pools) != 1:
        return False
    es = pools[0].get("entries", [])
    if len(es) != 1:
        return False
    e = es[0]
    return e.get("type") == "minecraft:item" and e.get("name") == f"nookworks:{block}" and not e.get("functions") \
        and not e.get("conditions") and not pools[0].get("conditions", [{"type": "minecraft:survives_explosion"}])[0].get("type", "").endswith("table_bonus")

def convert_loot(block_ids):
    """Plain drops stay with Bedrock; anything conditional is evaluated by the script from the Java table."""
    scripted = {}
    for f in (JDATA / "nookworks/loot_table/blocks").glob("*.json"):
        b = f.stem
        lt = json.load(open(f, encoding="utf8"))
        if b in block_ids and not simple_self_drop(lt, b):
            scripted[b] = lt
    write_json(BP / "loot_tables/empty.json", {"pools": []})
    return scripted

# ---------------------------------------------------------------- data for scripts

def export_script_data(machine_recipes, scripted_loot, tags, items_info, block_states, lang_keys):
    names = {}
    for i in set(items_info) | set(block_states) | {p.stem for p in (JASSETS / "items").glob("*.json")}:
        names[i] = f"item.nookworks.{i}" if f"item.nookworks.{i}" in lang_keys else f"block.nookworks.{i}"
    data = {"nameKeys": names, "dataMaps": {}, "loot": {}, "machineRecipes": machine_recipes, "blockLoot": scripted_loot,
            "features": json.load(open(JRES / "nookworks/features.json", encoding="utf8")),
            "blockStates": block_states, "items": items_info, "renames": {k: bid(k) for k in RENAMES}, "posters": {}}
    for f in (JDATA / "nookworks/data_maps").rglob("*.json"):
        data["dataMaps"][f"{f.parent.name}/{f.stem}"] = json.load(open(f, encoding="utf8"))
    for sub in ("sifting", "sifting_fine", "distillation"):
        for f in (JDATA / "nookworks/loot_table" / sub).rglob("*.json"):
            key = sub + "/" + str(f.relative_to(JDATA / "nookworks/loot_table" / sub)).replace("\\", "/")[:-5]
            data["loot"][key] = json.load(open(f, encoding="utf8"))
    for f in (JDATA / "nookworks/nookworks/poster").glob("*.json"):
        data["posters"][f.stem] = json.load(open(f, encoding="utf8"))
    from paths import VANILLA_JAVA
    pb = VANILLA_JAVA / "data/minecraft/loot_table/gameplay/piglin_bartering.json"
    if pb.exists():
        data["loot"]["piglin_bartering"] = json.load(open(pb, encoding="utf8"))
    data["smelting"] = smelting_table(tags)
    data["campfire"] = smelting_table(tags, ("campfire_cooking",))
    data["crafting9"] = nine_to_one(tags)
    data["tags"] = tags.all_used(data)
    out = BP / "scripts/generated/data.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("// Generated by tools/convert.py from the Java mod's data. Do not edit.\nexport const DATA = "
                   + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf8")

def _recipes():
    from paths import VANILLA_JAVA
    for root in (VANILLA_JAVA / "data/minecraft/recipe", JDATA / "nookworks/recipe"):
        for f in root.rglob("*.json"):
            try:
                yield json.load(open(f, encoding="utf8"))
            except Exception:
                pass

def smelting_table(tags, types=("smelting",)):
    """Bedrock input id -> [result id, ticks, xp] for vanilla's and our furnace recipes."""
    out = {}
    for r in _recipes():
        if r.get("type", "").replace("minecraft:", "") not in types:
            continue
        res = r["result"]["id"] if isinstance(r["result"], dict) else r["result"]
        for o in ingredient_options(r["ingredient"], tags):
            if "item" in o:
                out.setdefault(o["item"], [bid(res), r.get("cookingtime", 200), r.get("experience", 0)])
    return out

def nine_to_one(tags):
    """Item -> result of the 3x3 recipe of nine of it (the Compressor)."""
    out = {}
    for r in _recipes():
        if r.get("type", "").replace("minecraft:", "") != "crafting_shaped":
            continue
        pat = r.get("pattern", [])
        if len(pat) != 3 or any(len(row) != 3 for row in pat) or len(set("".join(pat))) != 1 or " " in "".join(pat):
            continue
        k = pat[0][0]
        opts = ingredient_options(r["key"][k], tags)
        res = r["result"]
        for o in opts:
            if "item" in o:
                out.setdefault(o["item"], [bid(res["id"]), res.get("count", 1)])
    return out

def _patch_data(key, value):
    f = BP / "scripts/generated/data.js"
    t = f.read_text(encoding="utf8").rstrip().rstrip(";")
    t = t[:-1] + f',"{key}":' + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "};\n"
    f.write_text(t, encoding="utf8")

def copy_overlay():
    """Hand-written files (scripts/, src_packs/) copied over the generated packs."""
    for src, dst in ((ROOT / "src_packs/bp", BP), (ROOT / "src_packs/rp", RP)):
        if src.exists():
            shutil.copytree(src, dst, dirs_exist_ok=True)
    import sys
    dev = "--dev" in sys.argv
    shutil.copytree(ROOT / "scripts", BP / "scripts", dirs_exist_ok=True,
                    ignore=None if dev else shutil.ignore_patterns("test"))
    (BP / "scripts/generated/dev.js").write_text(f"export const DEV = {'true' if dev else 'false'};\n", encoding="utf8")

def main():
    for p in (BP, RP):
        if p.exists():
            shutil.rmtree(p)
    manifests()
    poster_index = convert_posters.run(convert_items.item_tex, LANG_ADD)
    lang_keys = lang()
    tags = java_tags.Tags()
    meta = {}
    item_ids = {p.stem for p in (JASSETS / "items").glob("*.json")}
    for f in (JASSETS / "blockstates").glob("*.json"):
        if f.stem not in item_ids:
            meta[f.stem] = {"hidden": True}
    all_blocks = {f.stem for f in (JASSETS / "blockstates").glob("*.json")}
    scripted_loot = convert_loot(all_blocks)
    for b in scripted_loot:
        meta.setdefault(b, {}).setdefault("components", {})["minecraft:loot"] = "loot_tables/empty.json"
    for b, c in CROP_BLOCKS.items():
        meta.setdefault(b, {}).setdefault("components", {}).update(c)
    convert_blocks.copy_textures()
    block_states = convert_blocks.run(meta)
    block_ids = set(block_states)
    items, items_info = convert_items.convert(block_ids, lang_keys)
    for iid, it in items.items():
        bp_ = it.get("components", {}).get("minecraft:block_placer")
        if bp_ and iid in PLANTS_ON:
            bp_["use_on"] = PLANTS_ON[iid]
        tc = tool_items.components(iid)
        if tc and "components" in it:
            it["components"].update(tc)
        if "components" in it:
            write_json(BP / f"items/{iid}.json", {"format_version": "1.21.90", "minecraft:item": {
                "description": {"identifier": f"nookworks:{iid}", "menu_category": {"category": "items"}},
                "components": it["components"]}})
    for name, a in tool_items.attachables().items():
        write_json(RP / f"attachables/{name}.json", a)
    write_json(RP / "textures/terrain_texture.json", {"resource_pack_name": "nookworks", "texture_name": "atlas.terrain",
               "padding": 8, "num_mip_levels": 4,
               "texture_data": {k: {"textures": v} for k, v in sorted(convert_blocks.terrain.items())}})
    write_json(RP / "textures/item_texture.json", {"resource_pack_name": "nookworks", "texture_name": "atlas.items",
               "texture_data": {k: {"textures": v} for k, v in sorted(convert_items.item_tex.items())}})
    if convert_blocks.flipbooks:
        write_json(RP / "textures/flipbook_textures.json", convert_blocks.flipbooks)
    for iid, it in items.items():
        if it.get("components", {}).get("minecraft:max_stack_size") == 1:
            STACK_ONE.add(f"nookworks:{iid}")
    machine, nrec = convert_recipes(tags)
    export_script_data(machine, scripted_loot, tags, items_info, block_states, lang_keys)
    _patch_data("posterIndex", poster_index)
    copy_overlay()
    if (JASSETS / "../../pack.png").exists():
        pass
    icon = JASSETS / "icon.png"
    for p in (BP, RP):
        src = ROOT / "src_packs/pack_icon.png"
        if src.exists():
            shutil.copyfile(src, p / "pack_icon.png")
    w = convert_blocks.warnings + convert_items.warnings + [f"unknown bedrock id {u}" for u in sorted(UNKNOWN)] + [f"empty tag #{t}" for t in sorted(EMPTY_TAGS)]
    (ROOT / ".cache").mkdir(exist_ok=True)
    (ROOT / ".cache/convert_warnings.txt").write_text("\n".join(w), encoding="utf8")
    print(f"blocks {len(block_ids)}, items {sum(1 for i in items.values() if 'components' in i)} (+{sum(1 for i in items.values() if 'block' in i)} block items), "
          f"recipes {nrec}, machine recipes {len(machine)}, scripted loot {len(scripted_loot)}, warnings {len(w)}")

if __name__ == "__main__":
    main()
