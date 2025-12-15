// Player-facing window for talking to an NPC.

class DialoguePromptWindow extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ironic-dialogue-prompt",
      classes: ["ironic-dialogue"],
      template: "modules/ironic-dialogue-prompts/templates/dialogue-window.hbs",
      width: 520,
      height: "auto",
      resizable: true,
      title: "Dialogue"
    });
  }

  constructor(npc, dialogueFlagData, playerActor) {
    super();
    const d = dialogueFlagData?.dialogueNodes || dialogueFlagData || {};
    this.npc = npc;
    this.playerActor = playerActor ?? null;
    this.state = {
      current: d.start || "start",
      nodes: d.nodes || d
    };
  }

  getData() {
    const node = this.state.nodes?.[this.state.current] ?? { text: "Invalid node" };
    const opts = (node.options || []).map(o => {
        const res = o.requirement ? DialogueRequirements.check(this.playerActor, this.npc, o.requirement) : { ok: true };
        return {
        ...o,
        locked: !res.ok,                                   // hard-lock only if other reqs fail
        lockReason: DialogueRequirements.explainableLock(res),
        reqText: DialogueRequirements.describe(o.requirement) || null,
        needsRoll: !!res.needsRoll                         // flag for the template and click handler
        };
    });

    return {
        node,
        npcName: this.npc?.name ?? "NPC",
        actorName: this.playerActor?.name ?? "Preview",
        options: opts
    };
    }



  activateListeners(html) {
    super.activateListeners(html);
        html.on("click", ".dlg-option", async ev => {
    ev.preventDefault();
    const btn = ev.currentTarget;
    const optId = btn.dataset.optid;
    const node = this.state.nodes[this.state.current];
    const option = (node.options || []).find(o => String(o.id) === String(optId));
    if (!option) return;

    // Hard-locked? bail with reason
    if (btn.classList.contains("locked")) {
        const why = btn.dataset.reason || "Locked.";
        ui.notifications.warn(why);
        return;
    }

    // Re-evaluate requirement (fresh) and roll if needed
    if (option.requirement) {
        const res = DialogueRequirements.check(this.playerActor, this.npc, option.requirement);
        if (!res.ok) {
        ui.notifications.warn(DialogueRequirements.explainableLock(res) || "Requirement not met");
        return;
        }
        // If this requirement needs a roll (skill), perform it now
        if (res.needsRoll) {
        const pass = await DialogueRequirements.interactivePass(this.playerActor, this.npc, option.requirement);
        if (!pass) {
            ui.notifications.warn("Skill check failed.");
            return; // do not proceed
        }
        }
    }

    // proceed as before (run results, follow goto/next, etc.)
    let next = option.next || null;
    if (Array.isArray(option.results)) {
        for (const r of option.results) {
        const out = await DialogueResults.run(r, { playerActor: this.playerActor, npc: this.npc, app: this });
        if (out?.goto) next = out.goto;
        }
    }
    if (next === "END" || next === "end") return this.close();
    if (next) {
        if (this.state.nodes[next]) {
        this.state.current = next;
        this.render(true);
        } else {
        ui.notifications.warn(`Next node not found: ${next}`);
        }
    } else {
        this.render(true);
    }
    });

  }
}

window.DialoguePromptWindow = DialoguePromptWindow;
