"""Offline checks of the resource pack for what only the client validates: block geometry within Bedrock's
30x30x30 px box (unrotated bounds, x/z -15..15, y 0..30), every geometry/texture/render controller referenced
exists, no duplicate identifiers."""
import json, glob, os, re
from pathlib import Path
from paths import BP, RP

def load(f):
    return json.load(open(f, encoding="utf8"))

def main():
    problems = []
    geos = {}
    for f in RP.rglob("*.geo.json"):
        for g in load(f)["minecraft:geometry"]:
            gid = g["description"]["identifier"]
            if gid in geos: problems.append(f"duplicate geometry {gid}")
            geos[gid] = (f, g)
    for gid, (f, g) in geos.items():
        if "models/blocks" not in str(f).replace("\\", "/"): continue
        lo = [1e9] * 3; hi = [-1e9] * 3
        for b in g["bones"]:
            for c in b.get("cubes", []):
                for i in range(3):
                    lo[i] = min(lo[i], c["origin"][i]); hi[i] = max(hi[i], c["origin"][i] + c["size"][i])
        if lo[0] < -15 or hi[0] > 15 or lo[2] < -15 or hi[2] > 15 or lo[1] < 0 or hi[1] > 30:
            problems.append(f"geometry out of 30px box: {gid} {[round(x,1) for x in lo]} {[round(x,1) for x in hi]}")
    terrain = load(RP / "textures/terrain_texture.json")["texture_data"]
    items = load(RP / "textures/item_texture.json")["texture_data"]
    ours = lambda p: p.startswith("textures/nookworks/")
    for k, v in list(terrain.items()) + list(items.items()):
        p = v["textures"]
        if ours(p) and not (RP / (p + ".png")).exists(): problems.append(f"missing texture {p}")
    for f in BP.glob("blocks/*.json"):
        c = load(f)["minecraft:block"]
        comps = [c["components"]] + [p["components"] for p in c.get("permutations", [])]
        for cc in comps:
            g = cc.get("minecraft:geometry")
            gid = g if isinstance(g, str) else (g or {}).get("identifier")
            if gid and not gid.startswith("minecraft:") and gid not in geos: problems.append(f"{f.name}: no geometry {gid}")
            for mi in (cc.get("minecraft:material_instances") or {}).values():
                if mi.get("texture") not in terrain: problems.append(f"{f.name}: no terrain key {mi.get('texture')}")
    for f in BP.glob("items/*.json"):
        ic = load(f)["minecraft:item"]["components"].get("minecraft:icon")
        key = ic if isinstance(ic, str) else (ic or {}).get("texture") or (ic or {}).get("textures", {}).get("default")
        if key and key not in items: problems.append(f"{f.name}: no item texture {key}")
    rcs = {}
    for f in RP.rglob("*.render_controllers.json"):
        rcs.update(load(f)["render_controllers"])
    for f in list(RP.glob("entity/*.json")) + list(RP.glob("attachables/*.json")):
        d = load(f)
        desc = (d.get("minecraft:client_entity") or d.get("minecraft:attachable"))["description"]
        for g in desc.get("geometry", {}).values():
            if g not in geos and not g.startswith("geometry.humanoid"): problems.append(f"{f.name}: no geometry {g}")
        for t in desc.get("textures", {}).values():
            if ours(t) and not (RP / (t + ".png")).exists(): problems.append(f"{f.name}: missing texture {t}")
        for r in desc.get("render_controllers", []):
            r = r if isinstance(r, str) else next(iter(r))
            if r.startswith("controller.render.nookworks") and r not in rcs: problems.append(f"{f.name}: no render controller {r}")
    print("\n".join(problems) or "no problems found")
    return problems

if __name__ == "__main__":
    main()
