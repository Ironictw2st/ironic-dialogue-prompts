// Executes effects after an option is clicked.
// Result object: { type, key, value, data, on }

class DialogueResults {
  static async run(result, { playerActor, npc, app }) {
    const type = (result?.type || "").toLowerCase();
    try {
      switch (type) {
        case "goto":
          return { goto: String(result.value) };

        case "setflag": {
          const [scope, flagKey] = String(result.key || "").split(".");
          const target = this._pickTarget(result.on, { playerActor, npc });
          if (scope && flagKey && target?.setFlag) await target.setFlag(scope, flagKey, result.value);
          return;
        }
        case "unsetflag": {
          const [scope, flagKey] = String(result.key || "").split(".");
          const target = this._pickTarget(result.on, { playerActor, npc });
          if (scope && flagKey && target?.unsetFlag) await target.unsetFlag(scope, flagKey);
          return;
        }
        case "history": {
          const hist = foundry.utils.duplicate(playerActor.getFlag('ironic-dialogue-prompts','history') || {});
          hist[String(result.value || "visited")] = true;
          await playerActor.setFlag('ironic-dialogue-prompts','history', hist);
          return;
        }
        case "macro": {
          const name = String(result.value || "").trim();
          const macro = game.macros.getName(name);
          if (macro) await macro.execute({ playerActor, npc, app, data: result.data });
          else ui.notifications.warn(`Macro not found: ${name}`);
          return;
        }
        case "roll": {
          // {key:"skill|ability|formula", value:"pers|dex|1d20+5", dc:15, storeAs:"myCheck"}
          const k = (result.key || "formula").toLowerCase();
          let roll;
          if (k === "skill") {
            const v = Number(playerActor.system?.skills?.[result.value]?.total ?? playerActor.system?.skills?.[result.value]?.value ?? 0);
            roll = await (new Roll(`1d20 + ${v}`)).roll({async:true});
          } else if (k === "ability") {
            const mod = Number(playerActor.system?.abilities?.[result.value]?.mod ?? 0);
            roll = await (new Roll(`1d20 + ${mod}`)).roll({async:true});
          } else {
            roll = await (new Roll(String(result.value || "1d20"))).roll({async:true});
          }
          roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: playerActor }), flavor: "Dialogue Check" });
          if (result.storeAs) {
            const vars = foundry.utils.duplicate(playerActor.getFlag('ironic-dialogue-prompts','vars') || {});
            vars[result.storeAs] = roll.total;
            await playerActor.setFlag('ironic-dialogue-prompts','vars', vars);
          }
          if (typeof result.dc === "number") return { pass: roll.total >= result.dc, total: roll.total };
          return;
        }

        case "startfight": // alias
        case "startcombat": {
          const scene = game.scenes.current;
          let combat = game.combats?.active ?? await Combat.create({ scene: scene?.id });
          const ids = [];
          const npcToken = npc?.getActiveTokens?.()[0]; if (npcToken) ids.push(npcToken.id);
          const pcToken  = playerActor?.getActiveTokens?.()[0]; if (pcToken)  ids.push(pcToken.id);
          for (const tid of ids) if (!combat.combatants.find(c => c.tokenId === tid)) {
            await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tid }]);
          }
          await combat.startCombat();
          app.close();
          return;
        }

        case "opentrade": {
          npc?.sheet?.render(true, { focus: true });
          ui.notifications.info(`Opened ${npc?.name ?? "NPC"}'s sheet.`);
          return;
        }

        case "takeitem": // alias
        case "giveitem": {
          const name = String(result.value || "");
          const item = npc.items.find(i => i.name === name);
          if (item) await playerActor.createEmbeddedDocuments("Item", [item.toObject()]);
          else ui.notifications.warn(`Item not found on NPC: ${name}`);
          return;
        }

        case "removeitem": {
          const name = String(result.value || "");
          const it = playerActor.items.find(i => i.name === name);
          if (it) await it.delete();
          else ui.notifications.warn(`Item not found on Actor: ${name}`);
          return;
        }

        case "giverelation": {
          const api = game.modules.get("ironic-relational-tree")?.api;
          if (api?.bumpRelation) await api.bumpRelation(playerActor, npc, Number(result.value || 0));
          return;
        }

        case "ends":
          app.close(); return;

        default: return;
      }
    } catch (e) {
      console.error("Result error", e, result);
      ui.notifications.error("Dialogue result failed (see console).");
    }
  }

  static _pickTarget(on, { playerActor, npc }) {
    switch ((on || "actor").toLowerCase()) {
      case "actor": return playerActor;
      case "npc":   return npc;
      case "user":  return game.user;
      case "scene": return game.scenes.current;
      default:      return playerActor;
    }
  }
}
window.DialogueResults = DialogueResults;
