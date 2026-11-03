"""Bedrock components for our tools and armour (Java's ToolMaterial / ArmorMaterial numbers)."""

# material: (durability, speed, attack bonus, tier tag, enchantability)
MATERIALS = {
    "stone": (131, 4, 1, "stone", 5), "copper": (190, 5, 1, "copper", 13), "iron": (250, 6, 2, "iron", 14),
    "golden": (32, 12, 0, "golden", 22), "diamond": (1561, 8, 3, "diamond", 10), "netherite": (2031, 9, 4, "netherite", 15),
    "velarium": (3400, 11, 5.5, "netherite", 18),
}
REPAIR = {"stone": "minecraft:cobblestone", "copper": "minecraft:copper_ingot", "iron": "minecraft:iron_ingot",
          "golden": "minecraft:gold_ingot", "diamond": "minecraft:diamond", "netherite": "minecraft:netherite_ingot",
          "velarium": "nookworks:tempered_velarium_ingot"}
BASE_DAMAGE = {"sword": 4, "axe": 6, "pickaxe": 2, "shovel": 2.5, "hoe": 1, "hammer": 4}
DIG_TAG = {"pickaxe": "minecraft:is_pickaxe_item_destructible", "axe": "minecraft:is_axe_item_destructible",
           "shovel": "minecraft:is_shovel_item_destructible", "hoe": "minecraft:is_hoe_item_destructible",
           "sword": "minecraft:is_sword_item_destructible", "hammer": "minecraft:is_pickaxe_item_destructible"}
ARMOR = {"helmet": ("slot.armor.head", 4, "head"), "chestplate": ("slot.armor.chest", 9, "torso"),
         "leggings": ("slot.armor.legs", 7, "legs"), "boots": ("slot.armor.feet", 4, "feet")}
VELARIUM_DEFENCE = {"helmet": 4, "chestplate": 9, "leggings": 7, "boots": 4}

def components(iid):
    for kind in BASE_DAMAGE:
        if iid.endswith("_" + kind):
            mat = iid[: -len(kind) - 1]
            if mat not in MATERIALS:
                return None
            dur, speed, bonus, tier, ench = MATERIALS[mat]
            if kind == "hammer":
                dur *= 4
                speed = max(1, round(speed * 0.4))
            c = {
                "minecraft:max_stack_size": 1,
                "minecraft:hand_equipped": True,
                "minecraft:durability": {"max_durability": dur},
                "minecraft:damage": round(BASE_DAMAGE[kind] + bonus),
                "minecraft:enchantable": {"slot": {"sword": "sword", "axe": "axe", "pickaxe": "pickaxe", "shovel": "shovel",
                                                   "hoe": "hoe", "hammer": "pickaxe"}[kind], "value": ench},
                "minecraft:digger": {"use_efficiency": True, "destroy_speeds": [
                    {"block": {"tags": f"q.any_tag('{DIG_TAG[kind]}')"}, "speed": speed}]},
                "minecraft:tags": {"tags": [f"minecraft:{tier}_tier", "minecraft:is_tool"] +
                                   ([f"minecraft:is_{kind}"] if kind != "hammer" else ["minecraft:is_pickaxe", "nookworks:hammer"]) +
                                   (["minecraft:transformable_items"] if mat == "diamond" else [])},
                "minecraft:repairable": {"repair_items": [{"items": [REPAIR[mat]], "repair_amount": dur // 4}]},
            }
            if kind == "sword":
                c["minecraft:can_destroy_in_creative"] = False
            return c
    for piece, (slot, _, _) in ARMOR.items():
        if iid == f"velarium_{piece}":
            return {
                "minecraft:max_stack_size": 1,
                "minecraft:wearable": {"slot": slot, "protection": VELARIUM_DEFENCE[piece]},
                "minecraft:durability": {"max_durability": {"helmet": 11, "chestplate": 16, "leggings": 15, "boots": 13}[piece] * 50},
                "minecraft:enchantable": {"slot": {"helmet": "armor_head", "chestplate": "armor_torso", "leggings": "armor_legs", "boots": "armor_feet"}[piece], "value": 18},
                "minecraft:repairable": {"repair_items": [{"items": ["nookworks:tempered_velarium_ingot"], "repair_amount": 200}]},
                "minecraft:tags": {"tags": ["minecraft:is_armor", "minecraft:netherite_tier"]},
            }
    return None

def attachables():
    """RP attachables for the Velarium armour (vanilla armour geometry by id, our own texture)."""
    out = {}
    for piece, (slot, _, _) in ARMOR.items():
        tex = "textures/nookworks/entity/equipment/humanoid_leggings/velarium" if piece == "leggings" else \
              "textures/nookworks/entity/equipment/humanoid/velarium"
        geo = {"helmet": "geometry.humanoid.armor.helmet", "chestplate": "geometry.humanoid.armor.chestplate",
               "leggings": "geometry.humanoid.armor.leggings", "boots": "geometry.humanoid.armor.boots"}[piece]
        out[f"velarium_{piece}"] = {"format_version": "1.10.0", "minecraft:attachable": {"description": {
            "identifier": f"nookworks:velarium_{piece}",
            "materials": {"default": "armor", "enchanted": "armor_enchanted"},
            "textures": {"default": tex, "enchanted": "textures/misc/enchanted_item_glint"},
            "geometry": {"default": geo},
            "scripts": {"parent_setup": f"v.{'helmet' if piece == 'helmet' else 'chest' if piece == 'chestplate' else 'leg' if piece == 'leggings' else 'boot'}_layer_visible = 0.0;"},
            "render_controllers": ["controller.render.armor"]}}}
    return out
