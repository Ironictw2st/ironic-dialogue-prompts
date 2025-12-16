// Visual decision-tree viewer for dialogue graphs (no external libs).
// Builds an SVG from your dialogue model: { start, nodes: { id: { options:[{label,next,results:[]}] } } }

class DialogueGraphWindow extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ironic-dialogue-graph",
      classes: ["ironic-dialogue"],
      template: "modules/ironic-dialogue-prompts/templates/dialogue-graph.hbs",
      width: 920,
      height: 640,
      resizable: true,
      title: "Dialogue Decision Tree"
    });
  }

  /**
   * @param {Actor} npc
   * @param {{dialogueNodes?:object,start?:string,nodes?:object}} model
   */
  constructor(npc, model) {
    super();
    this.npc = npc;
    const d = model?.dialogueNodes || model || {};
    this.graph = { start: d.start || "start", nodes: foundry.utils.duplicate(d.nodes || {}) };
    this.layout = { width: 1000, height: 600 };
  }

  getData() {
    const nodes = this.graph.nodes;

    // 1) Build edges (from options). Pick explicit .next, or infer from results (goto/trade/combat/end).
    const edges = [];
    const pseudoTargets = new Map(); // id -> {id,type,label}

    const ensurePseudo = (id, type, label) => {
      if (!pseudoTargets.has(id)) pseudoTargets.set(id, { id, type, label });
      return id;
    };

    for (const [nid, node] of Object.entries(nodes)) {
      const options = Array.isArray(node.options) ? node.options : [];
      options.forEach((o, idx) => {
        let target = (o.next || "").trim();
        if (!target && Array.isArray(o.results)) {
          for (const r of o.results) {
            const t = (r?.type || "").toLowerCase();
            if (t === "goto" && r.value) { target = String(r.value); break; }
            if (t === "opentrade" || t === "ironicshop")        target = ensurePseudo("__TRADE__", "action", "Shop");
            if (t === "startcombat" || t === "startfight")
              target = ensurePseudo("__COMBAT__", "action", "Fight");
            if (t === "ends")             target = ensurePseudo("__END__", "end", "End");
          }
        }
        if (target === "END" || target === "end") target = ensurePseudo("__END__", "end", "End");
        if (target) edges.push({ from: nid, to: target, label: (o.label || `O${idx+1}`) });
      });
    }

    // 2) Collect nodes (including pseudo/action targets)
    const nodeMap = new Map();
    for (const [nid] of Object.entries(nodes)) {
      nodeMap.set(nid, { id: nid, label: nid, type: (nid === this.graph.start ? "start" : "normal") });
    }
    for (const p of pseudoTargets.values()) nodeMap.set(p.id, p);

    // Ensure the start node exists (placeholder OK)
    if (!nodeMap.has(this.graph.start)) {
      nodeMap.set(this.graph.start, { id: this.graph.start, label: this.graph.start, type: "start" });
    }

    // Ensure every edge endpoint exists; create placeholders for unknown targets
    for (const e of edges) {
      if (!nodeMap.has(e.from)) nodeMap.set(e.from, { id: e.from, label: e.from, type: "missing" });
      if (!nodeMap.has(e.to))   nodeMap.set(e.to,   { id: e.to,   label: e.to,   type: "missing" });
    }

    // 3) Layered layout (BFS from start). Unknown/isolated nodes get last layer.
    const start = this.graph.start;
    const layers = new Map(); // id -> depth
    const q = [start];
    layers.set(start, 0);

    while (q.length) {
      const cur = q.shift();
      const d = layers.get(cur);
      for (const e of edges.filter(x => x.from === cur)) {
        if (!layers.has(e.to)) { layers.set(e.to, d + 1); q.push(e.to); }
      }
    }

    // Place any unlabeled nodes after max layer
    const maxL = layers.size ? Math.max(...layers.values()) : 0;
    for (const id of nodeMap.keys()) if (!layers.has(id)) layers.set(id, maxL + 1);

    // 4) Assign XY positions
    const grouped = {};
    for (const [id, l] of layers.entries()) {
      grouped[l] ||= [];
      grouped[l].push(id);
    }
    const layerKeys = Object.keys(grouped).map(Number).sort((a,b)=>a-b);

    const H_GAP = 190, V_GAP = 140, PAD = 60;
    let maxX = 0, maxY = 0;
    for (const l of layerKeys) {
      const ids = grouped[l].sort();
      ids.forEach((id, i) => {
        const x = PAD + i * H_GAP;
        const y = PAD + l * V_GAP;
        let nm = nodeMap.get(id);
        if (!nm) { nm = { id, label: id, type: "missing" }; nodeMap.set(id, nm); }
        nm.x = x; nm.y = y;
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      });
    }

    const nodesArr = Array.from(nodeMap.values());
    const edgesArr = edges.map(e => ({
      ...e,
      x1: nodeMap.get(e.from)?.x ?? 0,
      y1: nodeMap.get(e.from)?.y ?? 0,
      x2: nodeMap.get(e.to  )?.x ?? 0,
      y2: nodeMap.get(e.to  )?.y ?? 0
    }));

    this.layout = { width: maxX + PAD + 140, height: maxY + PAD + 100 };

    return {
      npcName: this.npc?.name ?? "NPC",
      width: this.layout.width,
      height: this.layout.height,
      nodes: nodesArr,
      edges: edgesArr,
      start: this.graph.start
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Panning (middle mouse) and zooming (Ctrl+wheel)
    const svg = html.find("svg")[0];
    if (!svg) return;

    let view = { x:0, y:0, k:1 };
    const apply = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${this.layout.width/view.k} ${this.layout.height/view.k}`);
    apply();

    let dragging = false, last = null;
    svg.addEventListener("mousedown", (ev) => {
      if (ev.button !== 1) return; // middle
      dragging = true; last = { x: ev.clientX, y: ev.clientY }; ev.preventDefault();
    });
    window.addEventListener("mouseup", ()=> dragging=false);
    window.addEventListener("mousemove", (ev)=>{
      if (!dragging) return;
      const dx = (ev.clientX - last.x) * (1/view.k);
      const dy = (ev.clientY - last.y) * (1/view.k);
      view.x -= dx; view.y -= dy; last = { x: ev.clientX, y: ev.clientY };
      apply();
    });
    svg.addEventListener("wheel", (ev)=>{
      if (!ev.ctrlKey) return; // Ctrl + wheel to zoom
      ev.preventDefault();
      const d = Math.sign(ev.deltaY);
      view.k = Math.max(0.25, Math.min(2.5, view.k * (d>0 ? 0.9 : 1.1)));
      apply();
    });

    // Click node -> copy id to clipboard
    html.on("click", ".dg-node", (ev)=>{
      const id = ev.currentTarget.dataset.id;
      if (!id) return;
      navigator.clipboard?.writeText(id);
      ui.notifications.info(`Copied node id: ${id}`);
    });
  }
}

window.DialogueGraphWindow = DialogueGraphWindow;
