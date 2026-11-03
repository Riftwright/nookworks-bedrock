"""Draws a block two ways from the same viewpoint: from the Java model (blockstate variant + elements, Java's own
UV rules) and from the converted Bedrock geometry read back with Bedrock's conventions (x mirrored, up/down UV
reversed, rotations as tools/models.py writes them). Side by side, so a mirrored or misplaced part shows.

    python tools/render_check.py crusher oak_chair "dawnwood_stairs:facing=east,half=bottom,shape=straight"

Writes .cache/render/<block>.png (left Java, right Bedrock). It checks the converter against itself and against
Java; the engine's own reading of the conventions is the one thing it cannot check."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
from paths import ROOT, JASSETS, RP
import models as M
import vanilla_tex

OUT = ROOT / ".cache/render"
SCALE = 14
_tex = {}

def tex_img(tex_id):
    if tex_id in _tex:
        return _tex[tex_id]
    ns, p = tex_id.split(":", 1)
    f = JASSETS / "textures" / (p + ".png") if ns == "nookworks" else None
    im = None
    if f and f.exists():
        im = Image.open(f).convert("RGBA")
        if im.height > im.width:
            im = im.crop((0, 0, im.width, im.width))
    else:  # vanilla: a flat colour by name, so its faces still read
        h = abs(hash(p)) % 360
        im = Image.new("RGBA", (16, 16), tuple(int(100 + 80 * math.sin(math.radians(h + k))) for k in (0, 120, 240)) + (255,))
    _tex[tex_id] = im
    return im

def rot(p, axis, deg, origin):
    a = math.radians(deg)
    x, y, z = (p[i] - origin[i] for i in range(3))
    c, s = math.cos(a), math.sin(a)
    if axis == "x": y, z = y * c - z * s, y * s + z * c
    elif axis == "y": x, z = x * c + z * s, -x * s + z * c
    else: x, y = x * c - y * s, x * s + y * c
    return (x + origin[0], y + origin[1], z + origin[2])

FACE_CORNERS = {  # corners (u0v0, u1v0, u1v1, u0v1) of each face of a box f..t in Java space
    "north": lambda f, t: [(t[0], t[1], f[2]), (f[0], t[1], f[2]), (f[0], f[1], f[2]), (t[0], f[1], f[2])],
    "south": lambda f, t: [(f[0], t[1], t[2]), (t[0], t[1], t[2]), (t[0], f[1], t[2]), (f[0], f[1], t[2])],
    "west": lambda f, t: [(f[0], t[1], f[2]), (f[0], t[1], t[2]), (f[0], f[1], t[2]), (f[0], f[1], f[2])],
    "east": lambda f, t: [(t[0], t[1], t[2]), (t[0], t[1], f[2]), (t[0], f[1], f[2]), (t[0], f[1], t[2])],
    "up": lambda f, t: [(f[0], t[1], f[2]), (t[0], t[1], f[2]), (t[0], t[1], t[2]), (f[0], t[1], t[2])],
    "down": lambda f, t: [(f[0], f[1], t[2]), (t[0], f[1], t[2]), (t[0], f[1], f[2]), (f[0], f[1], f[2])],
}

def uv_rotate(uvs, deg):
    k = (deg // 90) % 4
    return uvs[k:] + uvs[:k]

def java_quads(bid, env):
    bs = json.load(open(JASSETS / f"blockstates/{bid}.json", encoding="utf8"))
    parts = []
    if "variants" in bs:
        for key, v in bs["variants"].items():
            v = v[0] if isinstance(v, list) else v
            if all(env.get(a) == b for a, b in (kv.split("=") for kv in key.split(",") if kv)):
                parts.append(v); break
    else:
        from convert_blocks import matches
        parts = [(p["apply"][0] if isinstance(p["apply"], list) else p["apply"]) for p in bs["multipart"] if matches(env, p.get("when"))]
    quads = []
    for a in parts:
        model = M.load(a["model"])
        for el in model["elements"] or []:
            f, t = el["from"], el["to"]
            for face, fd in el.get("faces", {}).items():
                tex = M.resolve_tex(model, fd.get("texture"))
                if not tex: continue
                pts = FACE_CORNERS[face](f, t)
                r = el.get("rotation")
                if r and r.get("angle"):
                    pts = [rot(p, r["axis"], r["angle"], r["origin"]) for p in pts]
                pts = [rot(p, "x", -a.get("x", 0), (8, 8, 8)) for p in pts]
                pts = [rot(p, "y", -a.get("y", 0), (8, 8, 8)) for p in pts]
                u0, v0, u1, v1 = fd.get("uv") or M.default_uv(face, f, t)
                uvs = uv_rotate([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], fd.get("rotation", 0))
                quads.append((pts, uvs, tex))
    return quads

def bedrock_quads(bid, env):
    """Our generated geometry, the bones whose visibility holds for env, back in Java space."""
    from convert_blocks import StateMap, collect_props, parts_of
    bs = json.load(open(JASSETS / f"blockstates/{bid}.json", encoding="utf8"))
    sm = StateMap(bid, collect_props(bs))
    parts = parts_of(bid, bs, sm)
    blk = json.load(open(ROOT / f"packs/nookworks_bp/blocks/{bid}.json", encoding="utf8"))["minecraft:block"]
    geo_c = blk["components"]["minecraft:geometry"]
    mats = blk["components"]["minecraft:material_instances"]
    terrain = json.load(open(RP / "textures/terrain_texture.json", encoding="utf8"))["texture_data"]
    path_of = {k: v["textures"] for k, v in terrain.items()}
    if geo_c == "minecraft:geometry.full_block":
        q = []
        for face in FACE_CORNERS:
            m = mats.get(face) or mats["*"]
            q.append((FACE_CORNERS[face]((0, 0, 0), (16, 16, 16)), [(0, 0), (16, 0), (16, 16), (0, 16)], key_tex(path_of[m["texture"]])))
        return q
    geo = json.load(open(RP / f"models/blocks/{bid}.geo.json", encoding="utf8"))["minecraft:geometry"][0]
    vis_mol = geo_c.get("bone_visibility", {})
    # visibility: a bone is shown when one of the Java parts it stands for matches env
    shown = set()
    keys = []
    for (mid, x, y, mol, m) in parts:
        k = (x, y, mol)
        if k not in keys: keys.append(k)
        if m(env): shown.add(f"p{keys.index(k)}")
    bones = {b["name"]: b for b in geo["bones"]}
    quads = []
    for b in geo["bones"]:
        top = b["name"].rstrip("x") if b["name"].endswith("x") and b["name"][:-1] in bones else b["name"]
        if top != "root" and top not in shown: continue
        chain = []
        cur = b
        while cur:
            chain.append(cur); cur = bones.get(cur.get("parent"))
        for c in b.get("cubes", []):
            o, s = c["origin"], c["size"]
            # Bedrock box back to Java space: x mirrored around 8
            f = (8 - (o[0] + s[0]), o[1], o[2] + 8); t = (8 - o[0], o[1] + s[1], o[2] + s[2] + 8)
            for face, fd in c["uv"].items():
                pts = FACE_CORNERS[face](f, t)
                if c.get("rotation"):
                    pv = c["pivot"]; jp = (8 - pv[0], pv[1], pv[2] + 8)
                    for ax, i in (("x", 0), ("y", 1), ("z", 2)):
                        if c["rotation"][i]: pts = [rot(p, ax, c["rotation"][i] * M.ROT_SIGN[i], jp) for p in pts]
                for bone in chain:      # innermost first
                    r = bone.get("rotation")
                    if not r: continue
                    pv = bone["pivot"]; jp = (8 - pv[0], pv[1], pv[2] + 8)
                    if r[0]: pts = [rot(p, "x", -(r[0] * M.STATE_X_SIGN), jp) for p in pts]
                    if r[1]: pts = [rot(p, "y", -(r[1] * M.STATE_Y_SIGN), jp) for p in pts]
                u, v = fd["uv"]; du, dv = fd["uv_size"]
                if face in ("up", "down") and M.FLIP_UP_DOWN_UV:
                    u, v, du, dv = u + du, v + dv, -du, -dv
                uvs = uv_rotate([(u, v), (u + du, v), (u + du, v + dv), (u, v + dv)], fd.get("uv_rotation", 0))
                m = mats.get(fd["material_instance"]) or mats["*"]
                quads.append((pts, uvs, key_tex(path_of[m["texture"]])))
    return quads

def key_tex(path):
    if path.startswith("textures/nookworks/"):
        return "nookworks:" + path[len("textures/nookworks/"):]
    return "minecraft:" + path

def project(p):
    x, y, z = p[0] - 8, p[1] - 8, p[2] - 8
    # view from south-east and above
    sx = (x - z) * math.cos(math.radians(30))
    sy = -y + (x + z) * 0.5
    depth = x + z + y * 0.8
    return sx * SCALE + 160, sy * SCALE + 170, depth

def draw(quads):
    im = Image.new("RGBA", (320, 340), (40, 44, 52, 255))
    frags = []
    for pts, uvs, tex in quads:
        img = tex_img(tex)
        n = 8
        for i in range(n):
            for j in range(n):
                a, b = i / n, j / n
                c4 = [(a, b), (a + 1 / n, b), (a + 1 / n, b + 1 / n), (a, b + 1 / n)]
                def lerp(s, t):
                    top = [pts[0][k] + (pts[1][k] - pts[0][k]) * s for k in range(3)]
                    bot = [pts[3][k] + (pts[2][k] - pts[3][k]) * s for k in range(3)]
                    return [top[k] + (bot[k] - top[k]) * t for k in range(3)]
                poly = [project(lerp(s, t)) for s, t in c4]
                uu = uvs[0][0] + (uvs[1][0] - uvs[0][0]) * (a + 0.5 / n) + (uvs[3][0] - uvs[0][0]) * (b + 0.5 / n)
                vv = uvs[0][1] + (uvs[1][1] - uvs[0][1]) * (a + 0.5 / n) + (uvs[3][1] - uvs[0][1]) * (b + 0.5 / n)
                px = img.getpixel((min(img.width - 1, max(0, int(uu / 16 * img.width))), min(img.height - 1, max(0, int(vv / 16 * img.height)))))
                if px[3] < 30: continue
                frags.append((sum(p[2] for p in poly) / 4, [(p[0], p[1]) for p in poly], px))
    frags.sort(key=lambda f: f[0])
    d = ImageDraw.Draw(im)
    for _, poly, col in frags:
        d.polygon(poly, fill=col)
    return im

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for arg in sys.argv[1:]:
        bid, _, st = arg.partition(":")
        env = dict(kv.split("=") for kv in st.split(",") if kv)
        bs = json.load(open(JASSETS / f"blockstates/{bid}.json", encoding="utf8"))
        from convert_blocks import StateMap, collect_props
        sm = StateMap(bid, collect_props(bs))
        full = sm.default_env(env)
        a, b = draw(java_quads(bid, full)), draw(bedrock_quads(bid, full))
        out = Image.new("RGBA", (640, 340)); out.paste(a, (0, 0)); out.paste(b, (320, 0))
        out.save(OUT / f"{bid}.png")
        print(OUT / f"{bid}.png")

if __name__ == "__main__":
    main()
