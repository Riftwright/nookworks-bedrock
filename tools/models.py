"""Java block/item models -> Bedrock geometry pieces.

Coordinate conventions (Java model space 0..16, x east, z south) -> Bedrock block geometry (x -8..8 mirrored,
z -8..8). The signs below follow Blockbench's Java->Bedrock conversion; they are kept in one place so a visual check
can flip them."""
import json
from functools import lru_cache
from paths import JASSETS, VANILLA_JAVA

# Checked against Blockbench's Bedrock codec (js/formats/bedrock): x mirrored, rotation x and y negated, z kept,
# up/down UVs reversed. A Java blockstate rotation (x, y) is the element rotation (-x, -y), so its Bedrock bone
# rotation is (+x, +y).
ROT_SIGN = (-1, -1, 1)        # element rotation [x, y, z] sign
STATE_Y_SIGN = 1              # blockstate y rotation
STATE_X_SIGN = 1              # blockstate x rotation
FLIP_UP_DOWN_UV = True

def norm_id(mid):
    if ":" not in mid:
        mid = "minecraft:" + mid
    return mid

def model_path(mid):
    ns, p = norm_id(mid).split(":", 1)
    if ns == "nookworks":
        return JASSETS / "models" / (p + ".json")
    return VANILLA_JAVA / "assets/minecraft/models" / (p + ".json")

@lru_cache(maxsize=None)
def load(mid):
    """Merged model: {'textures': {...}, 'elements': [...]|None, 'chain': [ids]}"""
    mid = norm_id(mid)
    if mid in ("minecraft:builtin/generated", "minecraft:builtin/entity"):
        return {"textures": {}, "elements": None, "chain": [mid]}
    f = model_path(mid)
    if not f.exists():
        return {"textures": {}, "elements": None, "chain": [mid], "missing": True}
    d = json.load(open(f, encoding="utf8"))
    base = load(d["parent"]) if "parent" in d else {"textures": {}, "elements": None, "chain": []}
    tex = dict(base["textures"])
    tex.update(d.get("textures", {}))
    return {"textures": tex, "elements": d.get("elements", base["elements"]), "chain": [mid] + base["chain"]}

def resolve_tex(model, ref, depth=0):
    if ref is None or depth > 10:
        return None
    if ref.startswith("#"):
        return resolve_tex(model, model["textures"].get(ref[1:]), depth + 1)
    if isinstance(ref, dict):
        ref = ref.get("sprite")
    return norm_id(ref)

def is_generated(model):
    return any(c in ("minecraft:item/generated", "minecraft:builtin/generated") for c in model["chain"]) \
        or (model["elements"] is None and "layer0" in model["textures"])

def default_uv(face, f, t):
    return {
        "down": [f[0], 16 - t[2], t[0], 16 - f[2]],
        "up": [f[0], f[2], t[0], t[2]],
        "north": [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]],
        "south": [f[0], 16 - t[1], t[0], 16 - f[1]],
        "west": [f[2], 16 - t[1], t[2], 16 - f[1]],
        "east": [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]],
    }[face]

def r(v):
    return round(v, 4)

def cube(el, model, mat_of):
    """One Java element -> Bedrock cube dict; mat_of(texture_id) -> material instance name."""
    f, t = el["from"], el["to"]
    c = {"origin": [r(8 - t[0]), r(f[1]), r(f[2] - 8)], "size": [r(t[0] - f[0]), r(t[1] - f[1]), r(t[2] - f[2])]}
    rot = el.get("rotation")
    if rot and rot.get("angle", 0):
        o = rot["origin"]
        ax = "xyz".index(rot["axis"])
        rv = [0, 0, 0]
        rv[ax] = ROT_SIGN[ax] * rot["angle"]
        c["pivot"] = [r(8 - o[0]), r(o[1]), r(o[2] - 8)]
        c["rotation"] = rv
    elif isinstance(rot, dict) and any(k in rot for k in ("x", "y", "z")):   # 26.x free rotation form
        o = rot.get("origin", [8, 8, 8])
        c["pivot"] = [r(8 - o[0]), r(o[1]), r(o[2] - 8)]
        c["rotation"] = [ROT_SIGN[0] * rot.get("x", 0), ROT_SIGN[1] * rot.get("y", 0), ROT_SIGN[2] * rot.get("z", 0)]
    uv = {}
    for face, fd in el.get("faces", {}).items():
        tex = resolve_tex(model, fd.get("texture"))
        if not tex:
            continue
        u = fd.get("uv") or default_uv(face, f, t)
        u0, v0, u1, v1 = u
        if FLIP_UP_DOWN_UV and face in ("up", "down"):
            e = {"uv": [r(u1), r(v1)], "uv_size": [r(u0 - u1), r(v0 - v1)]}
        else:
            e = {"uv": [r(u0), r(v0)], "uv_size": [r(u1 - u0), r(v1 - v0)]}
        if fd.get("rotation"):
            e["uv_rotation"] = fd["rotation"]
        e["material_instance"] = mat_of(tex)
        uv[face] = e
    c["uv"] = uv
    return c

def bbox(elements, xrot=0, yrot=0):
    """Java-space bounding box of the elements after a blockstate rotation (element rotations ignored)."""
    if not elements:
        return None
    lo = [99, 99, 99]; hi = [-99, -99, -99]
    for el in elements:
        for x in (el["from"][0], el["to"][0]):
            for y in (el["from"][1], el["to"][1]):
                for z in (el["from"][2], el["to"][2]):
                    p = rot_point((x, y, z), xrot, yrot)
                    for i in range(3):
                        lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
    return lo, hi

def rot_point(p, xrot, yrot):
    x, y, z = p[0] - 8, p[1] - 8, p[2] - 8
    for _ in range((xrot // 90) % 4):      # Java x rotation: north -> down (dispenser facing=down is x=90)
        y, z = z, -y
    for _ in range((yrot // 90) % 4):      # Java y rotation: clockwise from above, north -> east
        x, z = -z, x
    return (x + 8, y + 8, z + 8)

def is_full_cube(model):
    els = model["elements"]
    if not els or len(els) != 1:
        return False
    e = els[0]
    return e["from"] == [0, 0, 0] and e["to"] == [16, 16, 16] and not e.get("rotation") and \
        len(e.get("faces", {})) == 6 and all(("uv" not in fd or fd["uv"] == [0, 0, 16, 16]) and not fd.get("rotation")
                                            for fd in e["faces"].values())
