"""Posters and labels for Bedrock: one item per design (nookworks:poster_<name>), and one wall entity per size
(nookworks:poster_<w>x<h>) whose picture is chosen by its int property nookworks:design. Labels are a small wall
entity showing its item's name."""
import json
from paths import JDATA, BP, RP

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf8")

def square_icon(name, tex):
    """A poster's picture on a square transparent sheet, so its icon isn't stretched."""
    from PIL import Image
    from paths import JASSETS
    src = JASSETS / "textures" / (tex.replace("textures/nookworks/", "") + ".png")
    if not src.exists():
        return tex
    im = Image.open(src).convert("RGBA")
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    out = RP / f"textures/nookworks_poster_icon/{name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sq.save(out)
    return f"textures/nookworks_poster_icon/{name}"

def designs():
    out = {}
    for f in sorted((JDATA / "nookworks/nookworks/poster").glob("*.json")):
        d = json.load(open(f, encoding="utf8"))
        out[f.stem] = {"w": d["width"], "h": d["height"], "inks": d.get("inks"),
                       "tex": "textures/nookworks/poster/" + d["asset"].split(":")[1]}
    return out

def wall_entity(ident, w, h, extra_props=None, family="nookworks_poster"):
    props = extra_props or {}
    return {"format_version": "1.21.90", "minecraft:entity": {
        "description": {"identifier": ident, "is_spawnable": False, "is_summonable": True, **({"properties": props} if props else {})},
        "components": {
            "minecraft:collision_box": {"width": min(w, 1.0), "height": min(h, 1.0)},
            "minecraft:custom_hit_test": {"hitboxes": [{"width": max(w, 0.3), "height": max(h, 0.3), "pivot": [0, h / 2, 0]}]},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:knockback_resistance": {"value": 1},
            "minecraft:health": {"value": 1, "max": 1},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
            "minecraft:persistent": {},
            "minecraft:type_family": {"family": [family, "inanimate"]},
            "minecraft:fire_immune": {},
        }}}

def plane_geo(gid, w_px, h_px, depth=0.1):
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": gid, "texture_width": 16, "texture_height": 16},
        "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": [{
            "origin": [-w_px / 2, 0, -depth / 2], "size": [w_px, h_px, depth],
            "uv": {"north": {"uv": [0, 0], "uv_size": [16, 16]}, "south": {"uv": [16, 0], "uv_size": [-16, 16]}}}]}]}]}

def run(item_tex, lang_add):
    ds = designs()
    sizes = {}
    for name, d in ds.items():
        sizes.setdefault((d["w"], d["h"]), []).append(name)
        key = "nwp_" + name
        item_tex[key] = square_icon(name, d["tex"])
        write_json(BP / f"items/poster_{name}.json", {"format_version": "1.21.90", "minecraft:item": {
            "description": {"identifier": f"nookworks:poster_{name}", "menu_category": {"category": "items"}},
            "components": {"minecraft:icon": key, "minecraft:display_name": {"value": f"item.nookworks.poster_{name}"},
                           "minecraft:max_stack_size": 16}}})
        lang_add[f"item.nookworks.poster_{name}"] = ("item.nookworks.poster", f"poster.nookworks.{name}")
    index = {}
    for (w, h), names in sizes.items():
        ident = f"poster_{w}x{h}"
        n = len(names)
        write_json(BP / f"entities/{ident}.json", wall_entity(f"nookworks:{ident}", w, h, {
            "nookworks:design": {"type": "int", "range": [0, max(1, n - 1)], "default": 0, "client_sync": True}}))
        write_json(RP / f"models/entity/{ident}.geo.json", plane_geo(f"geometry.nookworks.{ident}", 16 * w, 16 * h))
        textures = {f"d{i}": ds[nm]["tex"] for i, nm in enumerate(names)}
        write_json(RP / f"entity/{ident}.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": f"nookworks:{ident}", "materials": {"default": "entity_alphatest"}, "textures": textures,
            "geometry": {"default": f"geometry.nookworks.{ident}"},
            "render_controllers": [f"controller.render.nookworks.{ident}"]}}})
        write_json(RP / f"render_controllers/{ident}.render_controllers.json", {"format_version": "1.10.0", "render_controllers": {
            f"controller.render.nookworks.{ident}": {
                "arrays": {"textures": {"Array.designs": [f"Texture.d{i}" for i in range(n)]}},
                "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
                "textures": ["Array.designs[q.property('nookworks:design')]"]}}})
        for i, nm in enumerate(names):
            index[nm] = {"entity": f"nookworks:{ident}", "design": i, "w": w, "h": h, "inks": ds[nm]["inks"]}
    # label: a small plaque, 8x6 px
    write_json(BP / "entities/label.json", wall_entity("nookworks:label", 0.5, 0.375, family="nookworks_label"))
    write_json(RP / "models/entity/label.geo.json", plane_geo("geometry.nookworks.label", 8, 6))
    write_json(RP / "entity/label.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "nookworks:label", "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/nookworks/entity/label"}, "geometry": {"default": "geometry.nookworks.label"},
        "render_controllers": ["controller.render.default"]}}})
    return index
