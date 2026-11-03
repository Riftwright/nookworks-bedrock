"""Hand-kept per-block extras for the generated block JSON: which blocks tick for scripts, and Bedrock
components with no Java counterpart in the data (crafting stations, ...)."""

TICK_INTERVAL = 10   # scripts/lib/blocks.js TICK

# blocks whose script runs every TICK_INTERVAL ticks
TICKING = {
    "generator", "diesel_generator", "creative_generator", "crusher", "sifter", "electric_furnace", "stone_maker",
    "printing_press", "electrolytic_cell", "retort", "distiller", "stirring_tank", "oil_press", "water_pump",
    "recycler", "compressor", "rice_polisher", "noodle_maker", "laser", "planter", "motor", "spawn_egg_brewer",
    "repair_box", "iron_pot", "nukadoko", "grill", "copper_tank", "mercury_tank", "experience_tank", "absorption_pad",
    "item_sorter", "precision_sorter", "item_warp_sender", "horizontal_item_warp_sender", "magnet_chest",
    "trash_can", "nested_timer", "dark_matter", "warp_anchor", "spawner_controller", "spawner_link_sender",
    "trading_counter", "barter_terminal", "hand_quern", "drive_wheel", "valve", "sight_glass", "copper_pipe",
    "mercury_pipe", "experience_pipe", "oil_lamp", "bread_tray", "drying_rack", "dice", "condenser",
    "iron_storage_barrel", "gold_storage_barrel", "diamond_storage_barrel", "netherite_storage_barrel",
    "velarium_storage_barrel", "wooden_tray", "filament_bulb", "valve", "hub_stone",
}

from pathlib import Path
# blocks whose scripts handle a tap (dumped from the scripts by the probe_api test into tools/interactive_blocks.txt);
# a block with onPlayerInteract takes every tap, so a held block can't be placed against it without sneaking
_INTERACTIVE = set(Path(__file__).with_name("interactive_blocks.txt").read_text().split())     if Path(__file__).with_name("interactive_blocks.txt").exists() else None

# tanks keep their liquid in their item, as Java's (one to a stack, as item data needs)
KEEPS_CONTENTS = {"copper_tank", "mercury_tank", "experience_tank"}
# the wall-mounted forms drop and are named as the standing ones (Java's overrideLootTable/overrideDescription)
DROPS_AS = {"wall_sconce": "sconce", "dawnwood_wall_sign": "dawnwood_sign", "dawnwood_wall_hanging_sign": "dawnwood_hanging_sign",
            "hanging_planter_green_trail": None, "hanging_planter_pink_trail": None, "hung_sweet_berries": None}
# plants come off when what they stand on goes
_SOIL = ["minecraft:farmland", "nookworks:nourished_soil"]
_DIRT = ["minecraft:dirt", "minecraft:grass_block", "minecraft:podzol", "minecraft:coarse_dirt", "minecraft:moss_block", "minecraft:farmland", "nookworks:nourished_soil", "minecraft:dirt_with_roots", "minecraft:mud"]
PLACED_ON = {"onions": _SOIL, "sunflower_crop": _SOIL, "end_sprout": _DIRT, "dawnwood_sapling": _DIRT}
TWO_HIGH = {"dawnwood_door", "daemon_door", "if_mirror", "standing_mirror", "recycler"}
KEEPS_DATA = {"crate", "magnet_chest", "placed_books", "book_row", "bookend", "placed_bottles", "wooden_tray", "plate",
              "grill", "nukadoko", "iron_pot", "daemon_door", "if_mirror", "standing_mirror", "spawner_link_receiver",
              "spawner_link_sender", "drive_wheel", "trash_can"}

def extra_components(bid):
    c = {"nookworks:behavior": {}}
    if _INTERACTIVE is None or bid in _INTERACTIVE:
        c["nookworks:interactive"] = {}
    if bid in TICKING or bid in KEEPS_DATA:
        c["minecraft:movable"] = {"movement_type": "immovable"}   # their data and screen stay where they were
    if bid in TICKING:
        c["nookworks:ticking"] = {}
        c["minecraft:tick"] = {"interval_range": [TICK_INTERVAL, TICK_INTERVAL], "looping": True}
    if bid in KEEPS_CONTENTS:
        c["minecraft:loot"] = "loot_tables/empty.json"   # scripts drop it with what it holds
    if bid in TWO_HIGH:
        c["minecraft:loot"] = "loot_tables/empty.json"   # scripts drop one item for the pair
    if bid in ("corn", "wine_glass", "mug", "pebbles"):
        c["minecraft:loot"] = "loot_tables/empty.json"   # scripts drop them (ripe ears; one per stacked piece)
    if bid == "crate":
        c["minecraft:loot"] = "loot_tables/empty.json"   # scripts drop it, with what it holds
    if bid in ("iron_workbench", "brass_workbench"):
        c["minecraft:crafting_table"] = {"crafting_tags": ["crafting_table", "nookworks_workbench"], "table_name": f"block.nookworks.{bid}"}
    return c

# multipart entries left out (Bedrock shows at most 64 conditional bones); scripts only use the states kept
SKIP_PARTS = {
    "sight_glass": lambda when: str((when or {}).get("level")) in ("1", "3", "5"),
}

# redstone output (Bedrock's minecraft:redstone_producer) while a state holds
REDSTONE_WHEN = {
    "dawnwood_button": "q.block_state('nookworks:powered')",
    "dawnwood_pressure_plate": "q.block_state('nookworks:powered')",
    "nested_timer": "q.block_state('nookworks:powered')",
}

# blocks Java draws with a renderer (no model): a model of ours stands in
MODEL_OVERRIDE = {
    "placed_books": "nookworks:block/placed_book_plain",
    "book_row": "nookworks:block/placed_book_plain_tall",
    "dice": "nookworks:block/dice_1",
    "drive_wheel": "nookworks:block/drive_wheel",
    "repair_box": "nookworks:block/repair_box",
    "daemon_door": "nookworks:block/daemon_door",
    "warp_anchor": ["nookworks:block/warp_anchor_ring", "nookworks:block/warp_anchor_core"],
}
TICKING |= {"chimney", "stone_brick_chimney", "nether_brick_chimney", "cobblestone_chimney", "ventilation_fan"}
