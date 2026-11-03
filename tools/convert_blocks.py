"""Java blockstates/models/textures -> Bedrock blocks (BP), geometry + terrain textures (RP).

Every blockstate becomes one geometry: one bone per (model, x, y) part, its blockstate rotation baked into the bone,
shown by a Molang condition on the block's states (bone_visibility). Facing/half/axis use Bedrock's placement traits
so placement works with no script; every other property becomes a custom state `nookworks:<name>`."""
import json, re, shutil
from pathlib import Path
from PIL import Image
from paths import *
import models as M
import vanilla_tex
import java_blocks
import behaviors

HORIZ = ["north", "south", "east", "west"]
DIRS6 = ["down", "up", "north", "south", "east", "west"]

terrain = {}        # key -> texture path
flipbooks = []
warnings = []
alpha_cache = {}

def tex_key(tex_id):
    """Java texture id -> terrain_texture key (registering it)."""
    ns, p = tex_id.split(":", 1)
    if ns == "nookworks":
        key = "nw_" + p.replace("/", "_")
        if key not in terrain:
            terrain[key] = "textures/nookworks/" + p
            mc = JASSETS / "textures" / (p + ".png.mcmeta")
            if mc.exists():
                meta = json.load(open(mc, encoding="utf8")).get("animation", {})
                flipbooks.append({"flipbook_texture": "textures/nookworks/" + p, "atlas_tile": key,
                                  "ticks_per_frame": meta.get("frametime", 1)})
        return key
    path = vanilla_tex.resolve(p)
    if not path:
        warnings.append(f"vanilla texture not found: {tex_id}")
        path = "textures/misc/missing_texture"
    key = "nwv_" + path.split("/")[-1]
    terrain[key] = path
    return key

def alpha_kind(tex_id):
    """'opaque' | 'alpha_test' | 'blend' from our own PNG; vanilla textures are judged by name."""
    if tex_id in alpha_cache:
        return alpha_cache[tex_id]
    ns, p = tex_id.split(":", 1)
    kind = "opaque"
    if ns == "nookworks":
        f = JASSETS / "textures" / (p + ".png")
        if f.exists():
            im = Image.open(f).convert("RGBA")
            a = im.getchannel("A")
            lo, hi = a.getextrema()
            if lo < 255:
                hist = a.histogram()
                kind = "blend" if sum(hist[1:250]) > (im.width * im.height) * 0.02 else "alpha_test"
    elif re.search(r"glass|sapling|flower|bush|torch|lantern|fern|roots|fungus|mushroom|propagule|leaves|lichen|"
                   r"bamboo|chain|bars|candle|blossom|tulip|poppy|dandelion|orchid|allium|bluet|daisy|rose|lily|"
                   r"cornflower|azalea|torchflower|water", p):
        kind = "blend" if "glass" in p or "water" in p else "alpha_test"
    alpha_cache[tex_id] = kind
    return kind

# ---------------------------------------------------------------- blockstate parsing

def parse_cond_key(key):
    if not key:
        return {}
    return dict(kv.split("=", 1) for kv in key.split(","))

def collect_props(bs):
    props = {}
    def add(k, v):
        props.setdefault(k, [])
        for x in str(v).split("|"):
            if x not in props[k]:
                props[k].append(x)
    def walk_when(w):
        if not w:
            return
        for k, v in w.items():
            if k in ("OR", "AND"):
                for sub in v:
                    walk_when(sub)
            else:
                add(k, v)
    if "variants" in bs:
        for key in bs["variants"]:
            for k, v in parse_cond_key(key).items():
                add(k, v)
    else:
        for part in bs["multipart"]:
            walk_when(part.get("when"))
    return props

class StateMap:
    """Java property -> Bedrock state (trait or custom) and Molang tests."""
    def __init__(self, bid, props):
        self.bid = bid
        self.props = props
        self.traits = {}
        self.custom = {}
        self.dir_state = None
        for k, vals in props.items():
            if k == "waterlogged":
                continue
            if k == "facing" and set(vals) <= set(HORIZ):
                self.traits.setdefault("minecraft:placement_direction", set()).add("minecraft:cardinal_direction")
                self.dir_state = ("minecraft:cardinal_direction", HORIZ)
            elif k == "facing" and set(vals) <= set(DIRS6):
                self.traits.setdefault("minecraft:placement_direction", set()).add("minecraft:facing_direction")
                self.dir_state = ("minecraft:facing_direction", DIRS6)
            elif k == "half" and set(vals) <= {"top", "bottom"}:
                self.traits.setdefault("minecraft:placement_position", set()).add("minecraft:vertical_half")
            elif k == "axis" and set(vals) <= {"x", "y", "z"} and "facing" not in props:
                self.traits.setdefault("minecraft:placement_position", set()).add("minecraft:block_face")
                if not self.dir_state:
                    self.dir_state = ("minecraft:block_face", DIRS6)
            else:
                self.custom[k] = self.ordered(k, vals)

    def ordered(self, k, vals):
        if set(vals) <= {"true", "false"}:
            return [False, True]
        if all(v.isdigit() for v in vals):
            nums = sorted(int(v) for v in vals)
            full = list(range(nums[0], nums[-1] + 1))
            return full if len(full) <= 16 else nums[:16]
        return list(vals)

    def test(self, k, v):
        """Molang for java property k == v (v may be 'a|b')."""
        if "|" in v:
            return "(" + " || ".join(self.test(k, x) for x in v.split("|")) + ")"
        if k == "waterlogged":
            return "true" if v == "false" else "false"
        if k == "facing":
            st = "minecraft:cardinal_direction" if "minecraft:cardinal_direction" in self.traits.get(
                "minecraft:placement_direction", ()) else "minecraft:facing_direction"
            return f"q.block_state('{st}') == '{v}'"
        if k == "half" and "minecraft:vertical_half" in self.traits.get("minecraft:placement_position", ()):
            return f"q.block_state('minecraft:vertical_half') == '{v}'"
        if k == "axis" and k not in self.custom:
            faces = {"x": ("east", "west"), "y": ("up", "down"), "z": ("north", "south")}[v]
            return "(" + " || ".join(f"q.block_state('minecraft:block_face') == '{f}'" for f in faces) + ")"
        vals = self.custom[k]
        if isinstance(vals[0], bool):
            return f"q.block_state('nookworks:{k}')" if v == "true" else f"!q.block_state('nookworks:{k}')"
        if isinstance(vals[0], int) and not isinstance(vals[0], bool):
            return f"q.block_state('nookworks:{k}') == {int(v)}"
        return f"q.block_state('nookworks:{k}') == '{v}'"

    def when(self, w):
        if not w:
            return "true"
        if "OR" in w:
            return "(" + " || ".join(self.when(x) for x in w["OR"]) + ")"
        if "AND" in w:
            return "(" + " && ".join(self.when(x) for x in w["AND"]) + ")"
        ts = [self.test(k, str(v)) for k, v in w.items()]
        ts = [t for t in ts if t != "true"]
        return " && ".join(ts) if ts else "true"

    def default_env(self, overrides=None):
        env = {}
        for k, vals in self.props.items():
            if k == "facing":
                env[k] = "north" if "north" in vals else vals[0]
            elif k == "half":
                env[k] = "bottom" if "bottom" in vals else vals[0]
            elif k == "axis":
                env[k] = "y" if "y" in vals else vals[0]
            elif k == "waterlogged":
                env[k] = "false"
            else:
                d = self.custom[k][0]
                env[k] = str(d).lower()
        env.update(overrides or {})
        return env

    def states_json(self):
        out = {}
        for k, vals in self.custom.items():
            if isinstance(vals[0], int) and not isinstance(vals[0], bool):
                out[f"nookworks:{k}"] = {"values": {"min": vals[0], "max": vals[-1]}} if vals == list(range(vals[0], vals[-1] + 1)) else vals
            else:
                out[f"nookworks:{k}"] = vals
        return out

def matches(env, key_or_when):
    if isinstance(key_or_when, str):
        return all(env.get(k) == v for k, v in parse_cond_key(key_or_when).items())
    w = key_or_when
    if not w:
        return True
    if "OR" in w:
        return any(matches(env, x) for x in w["OR"])
    if "AND" in w:
        return all(matches(env, x) for x in w["AND"])
    return all(env.get(k) in str(v).split("|") for k, v in w.items())

def simplify_keys(keys, props):
    """Variant keys (dicts) sharing one model -> fewer conjunctions, dropping properties that don't matter."""
    conj = [dict(k) for k in keys]
    changed = True
    while changed:
        changed = False
        for p, vals in props.items():
            if p == "waterlogged" or not conj or p not in conj[0]:
                continue
            groups = {}
            for c in conj:
                rest = tuple(sorted((k, v) for k, v in c.items() if k != p))
                groups.setdefault(rest, set()).add(c.get(p))
            if all(s >= set(vals) for s in groups.values()):
                conj = [dict(rest) for rest in groups]
                changed = True
        # waterlogged never matters
        if conj and "waterlogged" in conj[0]:
            conj = [dict(t) for t in {tuple(sorted((k, v) for k, v in c.items() if k != "waterlogged")) for c in conj}]
            changed = True
    return conj

# ---------------------------------------------------------------- conversion

def parts_of(bid, bs, sm):
    """[(model_id, x, y, molang, matcher)] where matcher(env)->bool."""
    parts = []
    if "variants" in bs:
        groups = {}
        for key, v in bs["variants"].items():
            if isinstance(v, list):
                v = v[0]
            g = (v["model"], v.get("x", 0), v.get("y", 0))
            groups.setdefault(g, []).append(parse_cond_key(key))
        for (mid, x, y), keys in groups.items():
            conj = simplify_keys(keys, sm.props)
            if len(conj) == 1 and not conj[0]:
                mol = "true"
            else:
                mol = " || ".join("(" + sm.when(c) + ")" for c in conj)
            parts.append((mid, x, y, mol, (lambda ks: lambda env: any(all(env.get(k) == v for k, v in c.items()) for c in ks))(conj)))
    else:
        skip = behaviors.SKIP_PARTS.get(bid)
        for part in bs["multipart"]:
            if skip and skip(part.get("when")):
                continue
            apps = part["apply"] if isinstance(part["apply"], list) else [part["apply"]]
            a = apps[0]
            w = part.get("when")
            parts.append((a["model"], a.get("x", 0), a.get("y", 0), sm.when(w), (lambda w: lambda env: matches(env, w))(w)))
    return parts

def geometry(bid, parts):
    mats = {}
    kinds = set()
    def mat_of(tex):
        if tex not in mats:
            mats[tex] = f"t{len(mats)}"
            kinds.add(alpha_kind(tex))
        return mats[tex]
    bones = [{"name": "root", "pivot": [0, 0, 0]}]
    vis = {}
    by_key = {}      # parts sharing a rotation and a condition share a bone (Bedrock caps bone_visibility)
    for i, (mid, x, y, mol, _) in enumerate(parts):
        model = M.load(mid)
        if model.get("missing"):
            warnings.append(f"{bid}: missing model {mid}")
            continue
        cubes = [M.cube(el, model, mat_of) for el in (model["elements"] or [])]
        key = (x, y, mol)
        if key in by_key:
            by_key[key].extend(cubes)
            continue
        name = f"p{len(by_key)}"
        b = {"name": name, "parent": "root", "pivot": [0, 8, 0]}
        if y:
            b["rotation"] = [0, M.STATE_Y_SIGN * y, 0]
        bones.append(b)
        if x:
            inner = {"name": name + "x", "parent": name, "pivot": [0, 8, 0], "rotation": [M.STATE_X_SIGN * x, 0, 0], "cubes": cubes}
            bones.append(inner)
            by_key[key] = inner["cubes"]
        else:
            b["cubes"] = cubes
            by_key[key] = b["cubes"]
        if mol != "true":
            vis[name] = mol
    for b in bones:
        b["cubes"] = [c for c in (clip_cube(c, bid) for c in b.get("cubes", [])) if c] if "cubes" in b else None
        if b["cubes"] is None:
            del b["cubes"]
    if len(vis) > 64:
        warnings.append(f"{bid}: {len(vis)} conditional bones (Bedrock takes 64)")
    geo = {"format_version": "1.21.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.nookworks.{bid}", "texture_width": 16, "texture_height": 16,
                        "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 0.75, 0]},
        "bones": bones}]}
    return geo, vis, mats, kinds

LIMIT = {0: (-15, 15), 1: (0, 30), 2: (-15, 15)}

def clip_cube(c, bid):
    """Bedrock refuses a block whose geometry leaves the 30x30x30 px box (x/z -15..15, y 0..30): parts outside are
    cut off, their side UVs shortened to match (Java crops sink a pixel, pots reach down over a campfire)."""
    if c.get("rotation") and any(c["rotation"]):
        return c
    o, s = list(c["origin"]), list(c["size"])
    for ax, (lo, hi) in LIMIT.items():
        cut_lo = max(0, lo - o[ax])
        cut_hi = max(0, o[ax] + s[ax] - hi)
        if not cut_lo and not cut_hi:
            continue
        if cut_lo + cut_hi >= s[ax]:
            warnings.append(f"{bid}: a part wholly outside Bedrock's box dropped")
            return None
        warnings.append(f"{bid}: part clipped to Bedrock's 30px box")
        if ax == 1:
            for face, fd in c["uv"].items():
                if face in ("up", "down") or not fd["uv_size"][1]:
                    continue
                sign = 1 if fd["uv_size"][1] > 0 else -1
                scale = abs(fd["uv_size"][1]) / s[1]
                fd["uv"][1] += sign * cut_hi * scale       # v runs from the top
                fd["uv_size"][1] -= sign * (cut_lo + cut_hi) * scale
        o[ax] += cut_lo
        s[ax] -= cut_lo + cut_hi
    c["origin"], c["size"] = [round(v, 4) for v in o], [round(v, 4) for v in s]
    return c

def render_method(kinds):
    if "blend" in kinds:
        return "blend"
    if "alpha_test" in kinds:
        return "alpha_test"
    return "opaque"

def box_json(lo, hi):
    lo = [max(0, min(16, v)) for v in lo]; hi = [max(0, min(16, v)) for v in hi]
    size = [max(hi[i] - lo[i], 0.5) for i in range(3)]
    lo = [min(lo[i], 16 - size[i]) for i in range(3)]
    # x mirrored as in geometry (Blockbench's bedrock_voxel_shape reads origin x as -(max x))
    return {"origin": [r(8 - (lo[0] + size[0])), r(lo[1]), r(lo[2] - 8)], "size": [r(s) for s in size]}

def r(v):
    return round(v, 3)

def visible_bbox(parts, env):
    lo = [99] * 3; hi = [-99] * 3; any_ = False
    for mid, x, y, mol, m in parts:
        if not m(env):
            continue
        model = M.load(mid)
        bb = M.bbox(model["elements"] or [], x, y)
        if not bb:
            continue
        any_ = True
        for i in range(3):
            lo[i] = min(lo[i], bb[0][i]); hi[i] = max(hi[i], bb[1][i])
    return (lo, hi) if any_ else None

def box_permutations(sm, parts, default_bb, collides):
    """Selection/collision boxes for every state combination whose shape differs from the default one."""
    props = {k: v for k, v in sm.props.items() if k != "waterlogged"}
    total = 1
    for v in props.values():
        total *= len(v)
    if total > 256 or not props:
        return []
    import itertools
    names = list(props)
    groups = {}
    for combo in itertools.product(*[props[n] for n in names]):
        env = dict(zip(names, combo))
        env["waterlogged"] = "false"
        b = visible_bbox(parts, env)
        if not b or b == default_bb:
            continue
        key = (tuple(b[0]), tuple(b[1]))
        groups.setdefault(key, []).append(dict(zip(names, combo)))
    out = []
    for (lo, hi), keys in groups.items():
        conj = simplify_keys(keys, props)
        cond = " || ".join("(" + sm.when(c) + ")" for c in conj)
        pc = {"minecraft:selection_box": box_json(list(lo), list(hi))}
        if collides:
            pc["minecraft:collision_box"] = box_json(list(lo), list(hi))
        out.append({"condition": cond, "components": pc})
    return out

def convert_block(bid, bs, block_meta):
    sm = StateMap(bid, collect_props(bs))
    parts = parts_of(bid, bs, sm)
    jp = java_blocks.props(bid)
    desc = {"identifier": f"nookworks:{bid}", "menu_category": {"category": block_meta.get("category", "construction")}}
    if block_meta.get("hidden"):
        desc["menu_category"] = {"category": "none", "is_hidden_in_commands": False}
    states = sm.states_json()
    if states:
        desc["states"] = states
    if sm.traits:
        tr = {}
        for t, st in sm.traits.items():
            tr[t] = {"enabled_states": sorted(st)}
            if t == "minecraft:placement_direction":
                tr[t]["y_rotation_offset"] = 180
        desc["traits"] = tr
    comps = {"minecraft:display_name": block_meta.get("name_key", f"block.nookworks.{bid}")}
    single = len(parts) == 1 and parts[0][3] == "true" and not parts[0][1] and not parts[0][2]
    full = single and M.is_full_cube(M.load(parts[0][0]))
    geo = None
    if full:
        model = M.load(parts[0][0])
        mi = {}
        kinds = set()
        for face, fd in model["elements"][0]["faces"].items():
            tex = M.resolve_tex(model, fd["texture"])
            mi[face] = {"texture": tex_key(tex)}
            kinds.add(alpha_kind(tex))
        rm = render_method(kinds)
        for v in mi.values():
            v["render_method"] = rm
        mi["*"] = dict(mi.get("north") or next(iter(mi.values())))
        comps["minecraft:geometry"] = "minecraft:geometry.full_block"
        comps["minecraft:material_instances"] = mi
        if rm != "opaque":
            comps["minecraft:light_dampening"] = 0
    else:
        geo, vis, mats, kinds = geometry(bid, parts)
        rm = render_method(kinds)
        g = {"identifier": f"geometry.nookworks.{bid}"}
        if vis:
            g["bone_visibility"] = vis
        comps["minecraft:geometry"] = g
        mi = {name: {"texture": tex_key(tex), "render_method": rm} for tex, name in mats.items()}
        if mi:
            mi["*"] = dict(next(iter(mi.values())))
        else:
            mi["*"] = {"texture": tex_key("nookworks:block/" + bid) if (JASSETS / f"textures/block/{bid}.png").exists()
                       else "nwv_missing_texture", "render_method": "alpha_test"}
            terrain.setdefault("nwv_missing_texture", "textures/misc/missing_texture")
        comps["minecraft:material_instances"] = mi
        comps["minecraft:light_dampening"] = 0
    # boxes
    env = sm.default_env()
    bb = visible_bbox(parts, env)
    perms = []
    if jp.get("collision") is False:
        comps["minecraft:collision_box"] = False
    elif bb and not full:
        comps["minecraft:collision_box"] = box_json(*bb)
    if bb and not full:
        comps["minecraft:selection_box"] = box_json(*bb)
    if not full:
        perms += box_permutations(sm, parts, bb, jp.get("collision") is not False)
    # mining
    h = jp.get("hardness", 1.5)
    if h < 0:
        comps["minecraft:destructible_by_mining"] = False
    else:
        comps["minecraft:destructible_by_mining"] = {"seconds_to_destroy": r(h * 1.5)}
    comps["minecraft:destructible_by_explosion"] = {"explosion_resistance": min(jp.get("resistance", h), 3600000)}
    light = jp.get("light", 0)
    if light and not jp.get("light_when"):
        comps["minecraft:light_emission"] = light
    elif light and f"nookworks:{jp['light_when']}" in states:
        perms.append({"condition": f"q.block_state('nookworks:{jp['light_when']}')",
                      "components": {"minecraft:light_emission": light}})
    if jp.get("no_loot"):
        comps["minecraft:loot"] = "loot_tables/empty.json"
    for k, v in {**behaviors.extra_components(bid), **block_meta.get("components", {})}.items():
        comps[k] = v
    if bid in behaviors.REDSTONE_WHEN:
        perms.append({"condition": behaviors.REDSTONE_WHEN[bid], "components": {"minecraft:redstone_producer": {"power": 15}}})
    if bid == "hub_stone":
        for pw in range(1, 16):
            perms.append({"condition": f"q.block_state('nookworks:power') == {pw}", "components": {"minecraft:redstone_producer": {"power": pw}}})
    block = {"format_version": "1.21.120", "minecraft:block": {"description": desc, "components": comps}}
    if perms:
        block["minecraft:block"]["permutations"] = perms
    return block, geo, jp.get("sound", "stone"), sm

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf8")

def copy_textures():
    src = JASSETS / "textures"
    dst = RP / "textures/nookworks"
    if dst.exists():
        shutil.rmtree(dst)
    for f in src.rglob("*.png"):
        out = dst / f.relative_to(src)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, out)

def run(block_meta_all):
    out = {}
    blocks_json = {"format_version": [1, 1, 0]}
    for f in sorted((JASSETS / "blockstates").glob("*.json")):
        bid = f.stem
        bs = json.load(open(f, encoding="utf8"))
        if bid in behaviors.MODEL_OVERRIDE:
            bs = {"variants": {"": {"model": behaviors.MODEL_OVERRIDE[bid]}}}
        meta = block_meta_all.get(bid, {})
        block, geo, sound, sm = convert_block(bid, bs, meta)
        write_json(BP / f"blocks/{bid}.json", block)
        if geo:
            write_json(RP / f"models/blocks/{bid}.geo.json", geo)
        blocks_json[f"nookworks:{bid}"] = {"sound": sound}
        out[bid] = {"states": block["minecraft:block"]["description"].get("states", {}),
                    "traits": {k: v["enabled_states"] for k, v in block["minecraft:block"]["description"].get("traits", {}).items()},
                    "props": sm.props}
    write_json(RP / "blocks.json", blocks_json)
    return out
