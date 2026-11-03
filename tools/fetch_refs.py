"""Fill .cache/ with reference data read from local installs (nothing is downloaded, nothing here is shipped):
vanilla Java block/item models (for geometry of parents like block/stairs) and the list of vanilla Bedrock
texture paths (so our packs can point at textures the game already has instead of copying them)."""
import json, re, zipfile
from paths import *

def main():
    CACHE.mkdir(exist_ok=True)
    jar = java_client_jar()
    with zipfile.ZipFile(jar) as z:
        for n in z.namelist():
            if re.match(r"(assets/minecraft/(models|blockstates|items)/|data/minecraft/(tags|recipe|loot_table/gameplay)/)", n) and n.endswith(".json"):
                out = VANILLA_JAVA / n
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(z.read(n))
    inst = bedrock_install()
    paths = set()
    for d in (inst / "data/resource_packs").iterdir():
        if not (d.name.startswith("vanilla") or d.name == "vanilla_base") or not (d / "contents.json").exists():
            continue
        c = json.load(open(d / "contents.json", encoding="utf8"))
        paths |= {re.sub(r"\.(png|tga)$", "", e["path"]) for e in c["content"]
                  if e["path"].startswith("textures/") and re.search(r"\.(png|tga)$", e["path"])}
    paths = sorted(paths)
    json.dump(paths, open(BEDROCK_TEX, "w"), indent=0)
    print("java vanilla models cached; bedrock textures:", len(paths))

if __name__ == "__main__":
    main()
