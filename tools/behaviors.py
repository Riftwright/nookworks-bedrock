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

def extra_components(bid):
    c = {"nookworks:behavior": {}}
    if bid in TICKING:
        c["nookworks:ticking"] = {}
        c["minecraft:tick"] = {"interval_range": [TICK_INTERVAL, TICK_INTERVAL], "looping": True}
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
}
TICKING |= {"chimney", "stone_brick_chimney", "nether_brick_chimney", "cobblestone_chimney", "ventilation_fan"}
