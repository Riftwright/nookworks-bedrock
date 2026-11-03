// Java ids -> Bedrock ids, and Java ingredients/tags tested against Bedrock items.
import { DATA } from "../generated/data.js";

export function bedrockId(jid) {
  if (!jid) return jid;
  if (!jid.includes(":")) jid = "minecraft:" + jid;
  return DATA.renames[jid] ?? jid;
}

const tagCache = new Map();
/** Java tag (without '#') -> Set of Bedrock item ids. */
export function tagItems(tag) {
  let s = tagCache.get(tag);
  if (!s) {
    s = new Set((DATA.tags[tag] ?? []).map(bedrockId));
    tagCache.set(tag, s);
  }
  return s;
}

/** Does a Bedrock item id match a Java ingredient ("id", "#tag", list, {item|tag|items|ingredient})? */
export function matches(ing, typeId) {
  if (!ing) return false;
  if (Array.isArray(ing)) return ing.some((i) => matches(i, typeId));
  if (typeof ing === "object") {
    if (ing.ingredient) return matches(ing.ingredient, typeId);
    if (ing.items) return matches(ing.items, typeId);
    if (ing.item) return matches(ing.item, typeId);
    if (ing.tag) return tagItems(ing.tag).has(typeId);
    return false;
  }
  if (ing.startsWith("#")) return tagItems(ing.slice(1)).has(typeId);
  return bedrockId(ing) === typeId;
}

/** Looks an item up in a Java data map ({values: {"id"|"#tag": v}}); returns the value or undefined. */
export function dataMapLookup(map, typeId) {
  const vals = map?.values ?? map ?? {};
  for (const [k, v] of Object.entries(vals)) {
    if (!k.startsWith("#") && bedrockId(k) === typeId) return v;
  }
  for (const [k, v] of Object.entries(vals)) {
    if (k.startsWith("#") && tagItems(k.slice(1)).has(typeId)) return v;
  }
  return undefined;
}
