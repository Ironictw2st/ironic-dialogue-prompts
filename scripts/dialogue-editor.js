// GM editor to author dialogue and store it on the NPC's flags.

class DialogueEditor extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ironic-dialogue-editor",
      classes: ["ironic-dialogue"],
      template: "modules/ironic-dialogue-prompts/templates/dialogue-editor.hbs",
      width: 880,
      height: 680,
      resizable: true,
      title: "Dialogue Editor"
    });
  }

  constructor(npc, opts={}) {
    super(npc, opts);
    this.npc = npc;

    const raw = npc.getFlag('ironic-dialogue-prompts','dialogue') ?? {};
    let base;

    if (raw.dialogueNodes && typeof raw.dialogueNodes === "object") {
      base = foundry.utils.duplicate(raw.dialogueNodes);
    } else if (raw.nodes && typeof raw.nodes === "object") {
      base = { start: raw.start || "start", nodes: foundry.utils.duplicate(raw.nodes) };
    } else {
      base = { start: "start", nodes: {} };
    }

    if (!base || typeof base !== "object") base = { start: "start", nodes: {} };
    if (!base.nodes || typeof base.nodes !== "object") base.nodes = {};

    if (!base.nodes[base.start]) {
      base.nodes[base.start] = { id: base.start, speaker: npc.name, text: "…", options: [] };
    }

    this.dataModel = base;
  }

  getData() {
    if (!this.dataModel || typeof this.dataModel !== "object") this.dataModel = { start: "start", nodes: {} };
    if (!this.dataModel.nodes || typeof this.dataModel.nodes !== "object") this.dataModel.nodes = {};
    if (!this.dataModel.nodes[this.dataModel.start]) {
      this.dataModel.nodes[this.dataModel.start] = { id: this.dataModel.start, speaker: this.npc.name, text: "…", options: [] };
    }

    const nodes = Object.values(this.dataModel.nodes).map((n, idx) => ({...n, idx}));
    return {
      npcName: this.npc.name,
      start: this.dataModel.start,
      nodes,
      showAdvanced: game.settings.get('ironic-dialogue-prompts','advanced-json')
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Change start node
    html.on("change", 'select[name="start"]', ev => {
      this.dataModel.start = ev.currentTarget.value;
    });

    // Add / Delete node
    html.on("click", "[data-action='add-node']", () => {
      const makeId =
        foundry?.utils?.randomID?.bind(foundry.utils) ||
        (window.randomID ? window.randomID : () => (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,16));

      const id = makeId();
      if (!this.dataModel.nodes || typeof this.dataModel.nodes !== "object") this.dataModel.nodes = {};
      this.dataModel.nodes[id] = { id, speaker: this.npc.name, text: "", options: [] };
      this.render(true);
    });

    html.on("click", "[data-action='del-node']", ev => {
      const id = ev.currentTarget.dataset.id;
      if (id === this.dataModel.start) return ui.notifications.warn("Cannot delete start node");
      delete this.dataModel.nodes[id];
      this.render(true);
    });

    // Rename node id
    html.on("change", ".node-id", ev => {
      const oldId = ev.currentTarget.dataset.oldid;
      const newId = ev.currentTarget.value.trim();
      if (!newId || newId === oldId) return;
      if (this.dataModel.nodes[newId]) { ui.notifications.warn("A node with that id already exists."); ev.currentTarget.value = oldId; return; }
      this.dataModel.nodes[newId] = this.dataModel.nodes[oldId];
      this.dataModel.nodes[newId].id = newId;
      delete this.dataModel.nodes[oldId];
      if (this.dataModel.start === oldId) this.dataModel.start = newId;
      for (const nid of Object.keys(this.dataModel.nodes)) {
        const n = this.dataModel.nodes[nid];
        (n.options||[]).forEach(o => { if (o.next === oldId) o.next = newId; });
      }
      this.render(true);
    });

    // Node edits
    html.on("input", ".node-text", ev => {
      const id = ev.currentTarget.dataset.id;
      this.dataModel.nodes[id].text = ev.currentTarget.value;
    });
    html.on("input", ".node-speaker", ev => {
      const id = ev.currentTarget.dataset.id;
      this.dataModel.nodes[id].speaker = ev.currentTarget.value;
    });

    // Options add/del
    html.on("click", "[data-action='add-opt']", ev => {
      const id = ev.currentTarget.dataset.id;
      const n = this.dataModel.nodes[id];
      const makeId =
        foundry?.utils?.randomID?.bind(foundry.utils) ||
        (window.randomID ? window.randomID : () => (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,16));

      const oid = makeId();
      (n.options ||= []).push({ id: oid, label: "Option", next: "", requirement: null, results: [] });
      this.render(true);
    });
    html.on("click", "[data-action='del-opt']", ev => {
      const [nid, oid] = [ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid];
      const n = this.dataModel.nodes[nid];
      n.options = (n.options || []).filter(o => String(o.id) !== String(oid));
      this.render(true);
    });

    // Option edits
    html.on("input", ".opt-label", ev => {
      const [nid, oid] = [ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid];
      const o = this._getOpt(nid, oid);
      o.label = ev.currentTarget.value;
    });
    html.on("change", ".opt-next", ev => {
      const [nid, oid] = [ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid];
      const o = this._getOpt(nid, oid);
      o.next = ev.currentTarget.value;
    });

    // Requirement JSON (advanced)
    html.on("input", ".opt-req", ev => {
      const [nid, oid] = [ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid];
      const o = this._getOpt(nid, oid);
      try {
        o.requirement = ev.currentTarget.value.trim() ? JSON.parse(ev.currentTarget.value) : null;
        ev.currentTarget.classList.remove("bad");
      } catch {
        ev.currentTarget.classList.add("bad");
      }
    });

    // Results JSON (advanced)
    html.on("input", ".opt-res", ev => {
      const [nid, oid] = [ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid];
      const o = this._getOpt(nid, oid);
      try {
        o.results = ev.currentTarget.value.trim() ? JSON.parse(ev.currentTarget.value) : [];
        ev.currentTarget.classList.remove("bad");
      } catch {
        ev.currentTarget.classList.add("bad");
      }
    });

    // ==== Requirement Builder (dropdowns) -> write JSON ====
    const rebuildReq = (nid, oid, row) => {
      const type = row.find(".req-type").val() || "";
      let req = null;
      const num = v => (v === "" || v === null || v === undefined) ? null : Number(v);

      switch (type) {
        case "ability":
          req = { type: "ability", key: row.find(".req-ability-key").val(), op: ">=", value: num(row.find(".req-ability-val").val()) ?? 10 };
          break;
        case "skill":
          req = { type: "skill", key: row.find(".req-skill-key").val(), op: ">=", value: num(row.find(".req-skill-val").val()) ?? 2 };
          break;
        case "race":
          req = { type: "race", value: row.find(".req-race-val").val() };
          break;
        case "language":
          req = { type: "language", op: "in", value: row.find(".req-language-val").val() };
          break;
        case "spell":
          req = { type: "spell", value: row.find(".req-spell-val").val() };
          break;
        case "proficiency":
          req = { type: "proficiency", value: row.find(".req-prof-val").val() };
          break;
        case "item":
          req = { type: "item", value: row.find(".req-item-val").val() };
          break;
        case "flag":
          req = { type: "flag", key: row.find(".req-flag-key").val(), op: row.find(".req-flag-op").val(), value: row.find(".req-flag-val").val() };
          break;
        case "previousAction":
          req = { type: "previousAction", value: row.find(".req-prev-val").val() };
          break;
        case "gmonly":
          req = { type: "gmonly" };
          break;
        default:
          req = null;
      }

      const o = this._getOpt(nid, oid);
      o.requirement = req;
      const ta = row.find(".opt-req")[0];
      if (ta) ta.value = req ? JSON.stringify(req, null, 2) : "";
    };

    const refreshReqVisibility = row => {
      const type = row.find(".req-type").val() || "";
      const classes = ["req-ability-only","req-skill-only","req-race-only","req-language-only","req-spell-only","req-prof-only","req-item-only","req-flag-only","req-prev-only"];
      classes.forEach(c => row.find(`.${c}`).hide());
      switch (type) {
        case "ability": row.find(".req-ability-only").show(); break;
        case "skill":   row.find(".req-skill-only").show(); break;
        case "race":    row.find(".req-race-only").show(); break;
        case "language":row.find(".req-language-only").show(); break;
        case "spell":   row.find(".req-spell-only").show(); break;
        case "proficiency": row.find(".req-prof-only").show(); break;
        case "item":    row.find(".req-item-only").show(); break;
        case "flag":    row.find(".req-flag-only").show(); break;
        case "previousAction": row.find(".req-prev-only").show(); break;
        default: break;
      }
    };

    const onReqChange = ev => {
      const row = $(ev.currentTarget).closest(".opt");
      const nid = ev.currentTarget.dataset.nid || row.find(".opt-label").data("nid");
      const oid = ev.currentTarget.dataset.oid || row.find(".opt-label").data("oid");
      refreshReqVisibility(row);
      rebuildReq(nid, oid, row);
    };

    html.on("change", ".req-type, .req-ability-key, .req-ability-val, .req-skill-key, .req-skill-val, .req-race-val, .req-language-val, .req-spell-val, .req-prof-val, .req-item-val, .req-flag-key, .req-flag-op, .req-flag-val, .req-prev-val", onReqChange);

    // Initial visibility
    html.find(".opt").each((_, el) => refreshReqVisibility($(el)));

    // === Results Builder ===
    const showFields = row => {
      const type = (row.find(".res-type").val() || "").toLowerCase();
      row.find(".rf").hide();
      if (["giveitem","removeitem","takeitem"].includes(type)) row.find(".rf-item").show();
      if (["setflag","unsetflag"].includes(type)) {
        row.find(".rf-flag").show();
        row.find(".rf-flag-val").toggle(type === "setflag");
      }
      if (type === "macro")     row.find(".rf-macro").show();
      if (type === "roll")      row.find(".rf-roll").show();
      if (type === "giverelation") row.find(".rf-relation").show();
    };

    const syncResultsTextarea = (nid, oid, row) => {
      if (!game.settings.get('ironic-dialogue-prompts','advanced-json')) return;
      const ta = row.closest(".opt").find(".opt-res")[0];
      if (!ta) return;
      const o = this._getOpt(nid, oid);
      ta.value = JSON.stringify(o.results || [], null, 2);
    };

    const ensureResults = (nid, oid) => {
      const o = this._getOpt(nid, oid);
      if (!Array.isArray(o.results)) o.results = [];
      return o.results;
    };

    html.on("click", ".res-add", ev => {
      const nid = ev.currentTarget.dataset.nid;
      const oid = ev.currentTarget.dataset.oid;
      const results = ensureResults(nid, oid);
      results.push({ type: "startCombat" });
      this.render(true);
    });

    html.on("click", ".res-del", ev => {
      const nid = ev.currentTarget.dataset.nid;
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const results = ensureResults(nid, oid);
      results.splice(ridx, 1);
      this.render(true);
    });

    html.on("change", ".res-type", ev => {
      const nid = ev.currentTarget.dataset.nid;
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const row = $(ev.currentTarget).closest(".res-row");
      const results = ensureResults(nid, oid);
      const t = ev.currentTarget.value;
      results[ridx] = { type: t }; // reset fields
      showFields(row);
      syncResultsTextarea(nid, oid, row);
    });

    const write = (nid, oid, ridx, patch) => {
      const results = ensureResults(nid, oid);
      results[ridx] = { ...(results[ridx] || {}), ...patch };
    };

    html.on("input", ".res-item-name", ev => {
      write(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, Number(ev.currentTarget.dataset.ridx), { value: ev.currentTarget.value });
      syncResultsTextarea(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, $(ev.currentTarget));
    });

    html.on("change input", ".res-on, .res-flag-key, .res-flag-val", ev => {
      const row = $(ev.currentTarget).closest(".res-row");
      const nid = ev.currentTarget.dataset.nid;
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const patch = {
        on:  row.find(".res-on").val(),
        key: row.find(".res-flag-key").val(),
        value: row.find(".res-flag-val").val()
      };
      write(nid, oid, ridx, patch);
      syncResultsTextarea(nid, oid, row);
    });

    html.on("input", ".res-macro-name", ev => {
      write(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, Number(ev.currentTarget.dataset.ridx), { value: ev.currentTarget.value });
      syncResultsTextarea(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, $(ev.currentTarget));
    });

    html.on("change input", ".res-roll-kind, .res-roll-value, .res-roll-dc, .res-roll-store", ev => {
      const row = $(ev.currentTarget).closest(".res-row");
      const nid = ev.currentTarget.dataset.nid;
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const patch = {
        key: row.find(".res-roll-kind").val(),
        value: row.find(".res-roll-value").val(),
        dc: Number(row.find(".res-roll-dc").val() || 0) || undefined,
        storeAs: row.find(".res-roll-store").val() || undefined
      };
      write(nid, oid, ridx, patch);
      syncResultsTextarea(nid, oid, row);
    });

    html.on("input", ".res-rel-delta", ev => {
      write(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, Number(ev.currentTarget.dataset.ridx), { value: Number(ev.currentTarget.value || 0) });
      syncResultsTextarea(ev.currentTarget.dataset.nid, ev.currentTarget.dataset.oid, $(ev.currentTarget));
    });

    html.find(".res-row").each((_, el) => showFields($(el)));

    // Save
    html.on("click", "[data-action='save']", async () => {
      await this.npc.setFlag('ironic-dialogue-prompts','dialogue', { dialogueNodes: this.dataModel });
      ui.notifications.info("Dialogue saved.");
      this.close();
    });

    // Preview
    html.on("click", "[data-action='preview']", () => {
      new DialoguePromptWindow(this.npc, { dialogueNodes: this.dataModel }, null).render(true);
    });

    html.on("click", "[data-action='dialogue_tree']", (ev) => {
        ev.preventDefault();
        if (!window.DialogueGraphWindow) {
            ui.notifications.warn("DialogueGraphWindow is not loaded. Did you include scripts/dialogue-graph.js and preload its template?");
            return;
        }
        new DialogueGraphWindow(this.npc, { dialogueNodes: this.dataModel }).render(true);
     });
  }

  _getOpt(nid, oid) {
    const n = this.dataModel.nodes[nid];
    return (n.options || []).find(o => String(o.id) === String(oid));
  }
}

window.DialogueEditor = DialogueEditor;
