"""Java items -> Bedrock items (BP) and item icons (RP item_texture.json)."""
import json, re
from PIL import Image
from paths import *
import models as M
import vanilla_tex

item_tex = {}
warnings = []
# items whose data is kept on the stack (Bedrock allows that only on unstackable items)
ONE_A_STACK = {"mob_bottle", "lode_pearl", "magnet", "advanced_magnet", "crate", "copper_tank", "mercury_tank", "experience_tank"}

def scan_java():
    """id -> {stack, durability, food:(n,sat), fire, places: block id, effect}"""
    consts = {}
    info = {}
    texts = {f: f.read_text(encoding="utf8") for f in (JSRC / "registry").glob("*.java")}
    for f in JSRC.rglob("*.java"):
        if "registry" not in str(f) and "gametest" not in str(f):
            t = f.read_text(encoding="utf8")
            if "registerBlock(" in t or "registerItem(" in t:
                texts[f] = t
    for t in texts.values():
        for m in re.finditer(r'(\w+)\s*=\s*(?:\w+\.)*BLOCKS\.register(?:Simple)?Block\(\s*"([a-z0-9_]+)"', t):
            consts[m.group(1)] = m.group(2)
        for m in re.finditer(r'(\w+)\s*=\s*\w+\(\s*"([a-z0-9_]+)"', t):
            consts.setdefault(m.group(1), m.group(2))
    for t in texts.values():
        for m in re.finditer(r'register(?:Simple)?Item\(\s*"([a-z0-9_]+)"', t):
            iid = m.group(1)
            end = t.find("public static final", m.end())
            seg = t[m.end(): end if end > 0 else m.end() + 500][:700]
            d = info.setdefault(iid, {})
            s = re.search(r"stacksTo\((\d+)\)", seg)
            if s: d["stack"] = int(s.group(1))
            s = re.search(r"durability\((\d+)\)", seg)
            if s: d["durability"] = int(s.group(1)); d["stack"] = 1
            s = re.search(r"nutrition\((\d+)\)\.saturationModifier\(([\d.]+)F?\)", seg)
            if s: d["food"] = (int(s.group(1)), float(s.group(2)))
            if "fireResistant()" in seg: d["fire"] = True
            if "usingConvertsTo(Items.BOWL)" in seg: d["bowl"] = True
            s = re.search(r"new \w*BlockItem\((?:\w+\.)*(\w+)\.get\(\)", seg) or re.search(r"new \w+Item\((?:\w+\.)*(\w+)\.get\(\)", seg)
            if s and s.group(1) in consts: d["places"] = consts[s.group(1)]
        for m in re.finditer(r'\b(food|bowlFood|meal)\(\s*"([a-z0-9_]+)",\s*(\d+),\s*([\d.]+)F', t):
            d = info.setdefault(m.group(2), {})
            d["food"] = (int(m.group(3)), float(m.group(4)))
            if m.group(1) == "bowlFood": d.update(stack=16, bowl=True)
        for m in re.finditer(r'registerSimpleBlockItem\((?:\w+\.)*(\w+)\)', t):
            if m.group(1) in consts:
                info.setdefault(consts[m.group(1)], {})["places"] = consts[m.group(1)]
    return info

def icon_key(tex_id):
    ns, p = tex_id.split(":", 1)
    if ns == "nookworks":
        key = "nw_" + p.replace("/", "_")
        item_tex[key] = "textures/nookworks/" + p
        return key
    path = vanilla_tex.resolve(p)
    if not path:
        warnings.append("vanilla item texture not found " + tex_id)
        path = "textures/misc/missing_texture"
    key = "nwv_" + path.split("/")[-1]
    item_tex[key] = path
    return key

def composite_icon(iid, layers):
    """Our own layers stacked into one PNG (vanilla layers are skipped)."""
    imgs = []
    for t in layers:
        ns, p = t.split(":", 1)
        f = JASSETS / "textures" / (p + ".png")
        if ns == "nookworks" and f.exists():
            im = Image.open(f).convert("RGBA")
            if im.height > im.width:
                im = im.crop((0, 0, im.width, im.width))
            imgs.append(im)
    if not imgs:
        return icon_key(layers[0])
    base = imgs[0]
    for im in imgs[1:]:
        base = Image.alpha_composite(base, im.resize(base.size))
    out = RP / f"textures/nookworks/item_composite/{iid}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out)
    key = "nwc_" + iid
    item_tex[key] = f"textures/nookworks/item_composite/{iid}"
    return key

_want = None

def first_model(d):
    t = d.get("type", "").replace("minecraft:", "")
    if t == "model":
        return d["model"]
    if t == "composite":
        return first_model(d["models"][0])
    if t == "condition":
        a, b = first_model(d["on_true"]), first_model(d["on_false"])
        return a if a and _want and _want in a else b
    if t == "select":
        return first_model(d.get("fallback") or d["cases"][0]["model"])
    if t == "range_dispatch":
        return first_model(d.get("fallback") or d["entries"][0]["model"])
    if t == "special":
        return d.get("base")
    return None

def icon_for(iid):
    f = JASSETS / "items" / f"{iid}.json"
    if not f.exists():
        return None, None
    global _want
    _want = iid
    mid = first_model(json.load(open(f, encoding="utf8"))["model"])
    if not mid:
        return None, None
    model = M.load(mid)
    if M.is_generated(model):
        layers = []
        i = 0
        while f"layer{i}" in model["textures"]:
            layers.append(M.resolve_tex(model, model["textures"][f"layer{i}"]))
            i += 1
        if len(layers) > 1:
            return composite_icon(iid, layers), "flat"
        return icon_key(layers[0]), "flat"
    # 3D model: a block's model shows itself; an item with a 3D model gets its particle/first texture as icon
    return mid, "model"

def convert(block_ids, lang_keys):
    info = scan_java()
    ids = sorted(p.stem for p in (JASSETS / "items").glob("*.json"))
    items_out = {}
    for iid in ids:
        d = info.get(iid, {})
        icon, kind = icon_for(iid)
        # an item is its block's own item only when Java registers it as one (an ear of corn shares the corn crop's
        # id but is food, planted as kernels)
        is_block = iid in block_ids and d.get("places", iid if not d.get("food") else None) == iid
        places = d.get("places") if d.get("places") in block_ids else (iid if is_block else None)
        if is_block and kind == "model" and d.get("stack", 64) == 64 and iid not in ONE_A_STACK:
            items_out[iid] = {"block": iid}
            continue          # the block's own item, drawn from its geometry
        comps = {}
        name_key = f"item.nookworks.{iid}" if f"item.nookworks.{iid}" in lang_keys else f"block.nookworks.{iid}"
        comps["minecraft:display_name"] = {"value": name_key}
        if kind == "flat":
            comps["minecraft:icon"] = icon
        else:
            model = M.load(icon) if icon else None
            tex = None
            if model:
                tex = M.resolve_tex(model, model["textures"].get("particle")) or \
                      next((M.resolve_tex(model, v) for v in model["textures"].values()), None)
            comps["minecraft:icon"] = icon_key(tex) if tex else icon_key("nookworks:item/" + iid)
        comps["minecraft:max_stack_size"] = 1 if iid in ONE_A_STACK else d.get("stack", 64)
        if d.get("durability"):
            comps["minecraft:durability"] = {"max_durability": d["durability"]}
        if d.get("food"):
            n, s = d["food"]
            comps["minecraft:food"] = {"nutrition": n, "saturation_modifier": s, "can_always_eat": False}
            if d.get("bowl"):
                comps["minecraft:food"]["using_converts_to"] = "minecraft:bowl"
            comps["minecraft:use_animation"] = "eat"
            comps["minecraft:use_modifiers"] = {"use_duration": 1.6, "movement_modifier": 0.35}
        if places:
            comps["minecraft:block_placer"] = {"block": f"nookworks:{places}"}
            if places == iid:
                comps["minecraft:block_placer"]["replace_block_item"] = True
        if d.get("fire"):
            comps["minecraft:fire_resistant"] = {"value": True}
        items_out[iid] = {"components": comps}
    return items_out, info
