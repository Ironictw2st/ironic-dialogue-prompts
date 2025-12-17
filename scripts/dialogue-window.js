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

  constructor(npc, dialogueData, playerActor) {
    super();
    this.npc = npc;
    this.playerActor = playerActor;
    this.state = {
        nodes: dialogueData.dialogueNodes?.nodes || dialogueData.nodes || {},
        current: dialogueData.dialogueNodes?.start || dialogueData.start || "start"
    };
    this._failedRolls = new Set(); // Track options where player failed a roll
    }

  getData() {
    const node = this.state.nodes?.[this.state.current] ?? { text: "Invalid node" };
    const opts = (node.options || []).map(o => {
        // Check if this option was already failed
        if (this._failedRolls.has(o.id)) {
            return {
                ...o,
                locked: true,
                lockReason: "Failed check",
                reqText: DialogueRequirements.describe(o.requirement) || null,
                needsRoll: false,
                visible: true
            };
        }
        
        const res = o.requirement ? DialogueRequirements.check(this.playerActor, this.npc, o.requirement) : { ok: true };
        
        // Handle hidden (passive) options
        if (o.hidden && o.requirement) {
            // For hidden options, do a passive check (no roll)
            const passiveCheck = DialogueRequirements.checkPassive(this.playerActor, this.npc, o.requirement);
            if (!passiveCheck.ok) {
                // Player doesn't meet passive requirement - hide the option entirely
                return {
                    ...o,
                    visible: false
                };
            }
        }
        
        return {
            ...o,
            locked: !res.ok,
            lockReason: DialogueRequirements.explainableLock(res),
            reqText: DialogueRequirements.describe(o.requirement) || null,
            needsRoll: !!res.needsRoll,
            visible: true
        };
    }).filter(o => o.visible !== false); // Filter out hidden options that failed passive check

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

    let rollPassed = null; // null = no roll needed, true = passed, false = failed
    
    // Re-evaluate requirement (fresh) and roll if needed
    if (option.requirement) {
        const res = DialogueRequirements.check(this.playerActor, this.npc, option.requirement);
        if (!res.ok) {
        ui.notifications.warn(DialogueRequirements.explainableLock(res) || "Requirement not met");
        return;
        }
        // If this requirement needs a roll (skill/ability), perform it now
        if (res.needsRoll) {
            rollPassed = await DialogueRequirements.interactivePass(this.playerActor, this.npc, option.requirement);
            
            if (!rollPassed) {
                // Track this failed roll so the option becomes locked
                this._failedRolls.add(option.id);
            }
        }
    }

    // Run results based on runOn property
    let next = option.next || null;
    if (Array.isArray(option.results)) {
        for (const r of option.results) {
            // Check if this result should run based on rollPassed
            const runOn = r.runOn || "always";
            
            // Skip if runOn doesn't match the roll result
            if (rollPassed !== null) {
                if (runOn === "pass" && !rollPassed) continue;
                if (runOn === "fail" && rollPassed) continue;
            }
            
            const out = await DialogueResults.run(r, { playerActor: this.playerActor, npc: this.npc, app: this });
            if (out?.goto) next = out.goto;
        }
    }
    
    // If roll failed and no explicit goto was set, show failure message and re-render
    if (rollPassed === false && !next) {
        ui.notifications.warn("Check failed.");
        this.render(true);
        return;
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