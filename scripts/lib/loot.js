// Java loot tables, evaluated in script (sifting, distillation, block drops with conditions).
import { DATA } from "../generated/data.js";
import { bedrockId } from "./ids.js";

function num(v, ctx) {
  if (typeof v === "number") return v;
  if (!v) return 1;
  const t = (v.type ?? "").replace("minecraft:", "");
  if (t === "uniform") {
    const lo = num(v.min, ctx), hi = num(v.max, ctx);
    return lo + Math.random() * (hi - lo);
  }
  if (t === "binomial") {
    let k = 0;
    const n = num(v.n, ctx), p = num(v.p, ctx);
    for (let i = 0; i < n; i++) if (Math.random() < p) k++;
    return k;
  }
  if (t === "constant") return v.value;
  return v.value ?? 1;
}

function cond(c, ctx) {
  const t = (c.condition ?? c.type ?? "").replace("minecraft:", "");
  switch (t) {
    case "random_chance":
      return Math.random() < num(c.chance, ctx);
    case "random_chance_with_enchanted_bonus":
      return Math.random() < num(c.unenchanted_chance ?? 0.1, ctx);
    case "survives_explosion":
      return !ctx.explosion || Math.random() < 0.5;
    case "inverted":
      return !cond(c.term, ctx);
    case "any_of":
    case "alternative":
      return (c.terms ?? []).some((x) => cond(x, ctx));
    case "all_of":
      return (c.terms ?? []).every((x) => cond(x, ctx));
    case "match_tool": {
      const tool = ctx.tool;
      const pred = c.predicate ?? {};
      if (pred.items) {
        const items = [].concat(pred.items);
        const ids = items.flatMap((i) => (i.startsWith("#") ? DATA.tags[i.slice(1)] ?? [] : [i])).map(bedrockId);
        if (!tool || !ids.includes(tool.typeId)) return false;
      }
      const ench = JSON.stringify(pred).match(/silk_touch/);
      if (ench) return !!ctx.silk;
      return true;
    }
    case "block_state_property": {
      for (const [k, v] of Object.entries(c.properties ?? {})) {
        const cur = ctx.states?.[k];
        if (cur === undefined) continue;
        if (typeof v === "object") {
          if (v.min !== undefined && Number(cur) < Number(v.min)) return false;
          if (v.max !== undefined && Number(cur) > Number(v.max)) return false;
        } else if (String(cur) !== String(v)) return false;
      }
      return true;
    }
    case "table_bonus":
      return Math.random() < (c.chances?.[ctx.fortune ?? 0] ?? c.chances?.[0] ?? 1);
    case "killed_by_player":
      return !!ctx.player;
    case "reference": {
      const n = c.name ?? "";
      if (/shear/.test(n)) return !!ctx.tool && /shears/.test(ctx.tool.typeId);
      if (/silk/.test(n)) return !!ctx.silk;
      return true;
    }
    case "value_check":
    case "entity_properties":
    case "location_check":
    case "weather_check":
    case "time_check":
    default:
      return true;
  }
}

function conds(list, ctx) {
  return !list || [].concat(list).every((c) => cond(c, ctx));
}

function applyFns(fns, out, ctx) {
  for (const f of [].concat(fns ?? [])) {
    if (!conds(f.conditions, ctx)) continue;
    const t = (f.function ?? f.type ?? "").replace("minecraft:", "");
    if (t === "set_count") out.n = f.add ? out.n + Math.floor(num(f.count, ctx)) : Math.floor(num(f.count, ctx));
    else if (t === "apply_bonus" && (f.formula ?? "").includes("binomial_with_bonus_count")) {
      // crops: extra tries of a chance each, Fortune adding tries
      const tries = (f.parameters?.extra ?? 0) + (ctx.fortune ?? 0);
      for (let i = 0; i < tries; i++) if (Math.random() < (f.parameters?.probability ?? 0.5)) out.n++;
    } else if (t === "apply_bonus" && ctx.fortune) {
      if (f.formula?.includes("ore_drops")) out.n *= Math.max(1, 1 + Math.floor(Math.random() * (ctx.fortune + 2)) - 1);
      else if (f.formula?.includes("uniform_bonus_count")) out.n += Math.floor(Math.random() * (ctx.fortune * (f.parameters?.bonusMultiplier ?? 1) + 1));
    } else if (t === "limit_count") {
      if (f.limit?.max !== undefined) out.n = Math.min(out.n, num(f.limit.max, ctx));
      if (f.limit?.min !== undefined) out.n = Math.max(out.n, num(f.limit.min, ctx));
    } else if (t === "copy_components" || t === "copy_state") out.copy = true;
  }
}

function entry(e, ctx, out) {
  const t = (e.type ?? "").replace("minecraft:", "");
  if (!conds(e.conditions, ctx)) return false;
  if (t === "alternatives") {
    for (const c of e.children ?? []) if (entry(c, ctx, out)) return true;
    return false;
  }
  if (t === "group") {
    for (const c of e.children ?? []) entry(c, ctx, out);
    return true;
  }
  if (t === "sequence") {
    for (const c of e.children ?? []) if (!entry(c, ctx, out)) return true;
    return true;
  }
  if (t === "empty") return true;
  if (t === "loot_table") {
    const ref = typeof e.value === "string" ? e.value : e.name;
    out.push(...roll(ref, ctx));
    return true;
  }
  if (t === "tag") {
    const items = DATA.tags[e.name] ?? [];
    if (e.expand) {
      if (items.length) out.push({ id: bedrockId(items[Math.floor(Math.random() * items.length)]), n: 1 });
    } else for (const i of items) out.push({ id: bedrockId(i), n: 1 });
    return true;
  }
  if (t === "item") {
    const o = { id: bedrockId(e.name), n: 1 };
    applyFns(e.functions, o, ctx);
    applyFns(e.modifier, o, ctx);
    applyFns(e.modifiers, o, ctx);
    if (o.n > 0) out.push(o);
    return true;
  }
  return false;
}

function pickWeighted(entries, ctx) {
  const ok = entries.filter((e) => conds(e.conditions, ctx));
  const total = ok.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const e of ok) {
    r -= e.weight ?? 1;
    if (r < 0) return e;
  }
  return ok[ok.length - 1];
}

/** Evaluates a Java loot table (object, or a key into DATA.loot / DATA.blockLoot) -> [{id, n}]. */
export function roll(table, ctx = {}) {
  if (typeof table === "string") {
    const key = table.replace(/^nookworks:/, "");
    table = DATA.loot[key] ?? DATA.blockLoot[key.replace(/^blocks\//, "")];
    if (!table) return [];
  }
  const out = [];
  for (const pool of table.pools ?? []) {
    if (!conds(pool.conditions, ctx)) continue;
    const rolls = Math.floor(num(pool.rolls, ctx));
    for (let i = 0; i < rolls; i++) {
      const es = pool.entries ?? [];
      // alternatives/groups are taken in order; plain item lists are weighted
      if (es.length === 1 || es.some((e) => /alternatives|group|sequence/.test(e.type))) {
        for (const e of es) entry(e, ctx, out);
      } else {
        const e = pickWeighted(es, ctx);
        if (e) entry(e, ctx, out);
      }
    }
    applyFns(pool.functions, { n: 0 }, ctx);
  }
  applyFns(table.functions, { n: 0 }, ctx);
  return out;
}

/** Every item a table can give (for summaries in forms). */
export function possible(table) {
  if (typeof table === "string") table = DATA.loot[table.replace(/^nookworks:/, "")];
  const out = new Set();
  const walk = (e) => {
    if (e.name && (e.type ?? "").includes("item")) out.add(bedrockId(e.name));
    for (const c of e.children ?? []) walk(c);
  };
  for (const p of table?.pools ?? []) for (const e of p.entries ?? []) walk(e);
  return [...out];
}
