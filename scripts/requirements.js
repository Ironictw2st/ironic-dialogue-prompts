// Simple requirements engine for D&D5e (v10+ / v11+ / v12+ / v13).
// Each requirement object is { type, key, op, value, anyOf, allOf, not, note }
// Evaluate against a playerActor (or null for Preview) and an npc.

class DialogueRequirements {
  static explainableLock(result) {
    if (result.ok) return null;
    const reasons = result.reasons?.length ? result.reasons : ["Requirement not met"];
    return reasons.join("; ");
  }

  // In DialogueRequirements class:

static describe(req) {
  // (keep your version; ensure it formats skill nicely)
  if (!req) return "";
  if (Array.isArray(req.allOf)) return req.allOf.map(r => this.describe(r)).filter(Boolean).join(" & ");
  if (Array.isArray(req.anyOf)) return req.anyOf.map(r => this.describe(r)).filter(Boolean).join(" | ");
  if (req.not) return `NOT (${this.describe(req.not)})`;

  const t = (req.type || "").toLowerCase();
  switch (t) {
    case "ability":      return `${(req.key||"").toUpperCase()} ≥ ${req.value ?? "?"}`;
    case "skill":        return `Skill ${req.key?.toUpperCase()} ≥ ${req.value ?? "10"}`;
    case "race":         return `Race: ${req.value}`;
    case "language":     return `Language: ${req.value}`;
    case "spell":        return `Spell known: ${req.value}`;
    case "proficiency":  return `Proficiency: ${req.value?.toUpperCase()}`;
    case "item":         return `Has item: ${req.value}`;
    case "flag":         return `Flag ${req.key} ${req.op ?? "=="} ${String(req.value)}`;
    case "previousaction": return `Did: ${req.value}`;
    case "relation":     return `Relation ${req.op ?? ">="} ${req.value}`;
    case "gmonly":       return `GM only`;
    default:             return "";
  }
}

static check(playerActor, npc, req) {
  if (!req) return { ok: true };

  // groups (unchanged)
  if (Array.isArray(req.allOf)) {
    const parts = req.allOf.map(r => this.check(playerActor, npc, r));
    const ok = parts.every(p => p.ok);
    return { ok, reasons: ok ? [] : parts.flatMap(p => p.reasons || []) };
  }
  if (Array.isArray(req.anyOf)) {
    const parts = req.anyOf.map(r => this.check(playerActor, npc, r));
    const ok = parts.some(p => p.ok);
    return { ok, reasons: ok ? [] : parts.flatMap(p => p.reasons || []) };
  }
  if (req.not) {
    const inner = this.check(playerActor, npc, req.not);
    return { ok: !inner.ok, reasons: inner.ok ? [`Must NOT satisfy: ${req.not?.type ?? "unknown"}`] : [] };
  }

  const t = (req?.type || "").toLowerCase();
  const op = (req?.op || ">=").toLowerCase();
  const key = req?.key;
  const val = req?.value;

  const miss = (why) => ({ ok: false, reasons: [why] });

  // If no PC yet, anything that needs actor state is locked
  if (!playerActor && ["ability","skill","race","language","spell","proficiency","item","flag","previousaction","relation"].includes(t)) {
    return miss(req?.note || "No PC selected");
  }

  try {
    switch (t) {
      case "skill": {
        // Interactive: do NOT hard-lock. We’ll roll on click vs DC = value (default 10).
        const dc = Number(val ?? 10);
        return { ok: true, needsRoll: { kind: "skill", key, dc } };
      }
      case "ability": {
        const a = playerActor.system?.abilities?.[key];
        const score = Number(a?.value ?? a?.score ?? 0);
        return evalCompare(score, Number(val), op) ? { ok: true } : miss(req?.note || `Requires ${key?.toUpperCase()} ${op} ${val}`);
      }
      case "race": {
        const race = (playerActor.system?.details?.race || "").toLowerCase();
        const want = String(val || "").toLowerCase();
        return race.includes(want) ? { ok: true } : miss(req?.note || `Requires race: ${val}`);
      }
      case "language": {
        const langs = playerActor.system?.traits?.languages?.value || [];
        return op === "in" ? (langs.includes(val) ? { ok: true } : miss(`Requires language: ${val}`)) : { ok: true };
      }
      case "spell": {
        const has = !!playerActor.items.find(i => i.type === "spell" && i.name.toLowerCase() === String(val).toLowerCase());
        return has ? { ok: true } : miss(req?.note || `Requires spell: ${val}`);
      }
      case "proficiency": {
        const prof = playerActor.system?.skills?.[val]?.proficient ?? 0;
        return prof > 0 ? { ok: true } : miss(req?.note || `Requires proficiency: ${val}`);
      }
      case "item": {
        const has = !!playerActor.items.find(i => i.name.toLowerCase() === String(val).toLowerCase());
        return has ? { ok: true } : miss(req?.note || `Requires item: ${val}`);
      }
      case "flag": {
        const [scope, flagKey] = String(key || "").split(".");
        const f = (scope && flagKey) ? playerActor.getFlag(scope, flagKey) : undefined;
        return evalCompare(f, val ?? true, op) ? { ok: true } : miss(req?.note || `Requires flag ${key} ${op} ${String(val)}`);
      }
      case "previousaction": {
        const hist = playerActor.getFlag('ironic-dialogue-prompts', 'history') || {};
        const got = hist?.[String(val)];
        return got ? { ok: true } : miss(req?.note || `Requires prior: ${val}`);
      }
      case "relation": {
        const relAPI = game.modules.get("ironic-relational-tree")?.api;
        if (!relAPI) return miss("Relation system missing");
        const score = Number(relAPI?.getRelation?.(playerActor, npc) ?? 0);
        return evalCompare(score, Number(val ?? 0), op) ? { ok: true } : miss(req?.note || `Requires relation ${op} ${val}`);
      }
      case "gmonly": {
        return game.user.isGM ? { ok: true } : miss("GM only");
      }
      default:
        return { ok: true };
    }
  } catch (e) {
    console.error("Requirement check error", e, req);
    return miss("Requirement error");
  }

  // local compare
  function evalCompare(lhs, rhs, op) {
    switch (op) {
      case ">=": return lhs >= rhs;
      case "<=": return lhs <= rhs;
      case ">":  return lhs > rhs;
      case "<":  return lhs < rhs;
      case "==": return lhs == rhs; // eslint-disable-line eqeqeq
      case "===":return lhs === rhs;
      case "!=": return lhs != rhs; // eslint-disable-line eqeqeq
      case "in": return Array.isArray(rhs) ? rhs.includes(lhs) : false;
      case "has":return (lhs && typeof lhs.includes === "function") ? lhs.includes(rhs) : false;
      default:   return !!lhs;
    }
  }
}


}


/** Roll any interactive requirement. Returns true if pass (or if no roll needed). */
DialogueRequirements.interactivePass = async function(actor, npc, req) {
  if (!req) return true;
  const t = (req.type || "").toLowerCase();
  if (t === "skill") {
    const dc  = Number(req.value ?? 10);
    const key = String(req.key || "").toLowerCase();
    const skl = actor?.system?.skills?.[key];
    const bonus = Number(skl?.total ?? skl?.value ?? 0);
    const roll = await (new Roll(`1d20 + ${bonus}`)).roll({async:true});
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `Dialogue Skill Check: ${key.toUpperCase()} vs DC ${dc}`
    });
    return roll.total >= dc;
  }
  // default: no interactive need
  return true;
};

window.DialogueRequirements = DialogueRequirements;
