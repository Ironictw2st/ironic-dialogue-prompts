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
    const pseudoNodes = {};
    const edges = [];

    const ensurePseudo = (pid, type, label) => {
      if (!pseudoNodes[pid]) pseudoNodes[pid] = { id: pid, type, label };
      return pid;
    };

    // Build edges from options and results
    for (const [nid, node] of Object.entries(nodes)) {
      const options = Array.isArray(node.options) ? node.options : [];
      options.forEach((o, idx) => {
        let target = (o.next || "").trim();
        let runOn = "always"; // default

        // Check results for goto and other actions
        if (Array.isArray(o.results)) {
          for (const r of o.results) {
            const t = (r?.type || "").toLowerCase();
            
            // Capture runOn from the result
            if (r.runOn) {
              runOn = r.runOn;
            }

            // Handle goto result type
            if (t === "goto" && r.value) {
              target = String(r.value);
              break;
            }
            
            // Handle other special result types
            if (t === "opentrade" || t === "ironicshop") {
              target = ensurePseudo("__TRADE__", "action", "Shop");
            }
            if (t === "startcombat" || t === "startfight") {
              target = ensurePseudo("__COMBAT__", "action", "Fight");
            }
            if (t === "ends") {
              target = ensurePseudo("__END__", "end", "End");
            }
          }
        }

        // Handle explicit "next" pointing to END
        if (!target && o.next) {
          target = o.next;
        }
        if (target === "END" || target === "end") {
          target = ensurePseudo("__END__", "end", "End");
        }

        // Create edge if we have a target
        if (target) {
          edges.push({
            from: nid,
            to: target,
            label: (o.label || `Option ${idx + 1}`),
            runOn: runOn
          });
        }
      });
    }

    // Layout calculation
    const allIds = [...Object.keys(nodes), ...Object.keys(pseudoNodes)];
    const positions = {};
    const PAD = 60;
    const W = 140, H = 60, GAPY = 80, GAPX = 180;

    // BFS layout from start
    const visited = new Set();
    const queue = [{ id: this.graph.start, depth: 0, lane: 0 }];
    const depthCount = {};
    let maxX = 0, maxY = 0;

    while (queue.length) {
      const { id, depth, lane } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      depthCount[depth] = (depthCount[depth] || 0) + 1;
      const x = PAD + depth * GAPX;
      const y = PAD + (depthCount[depth] - 1) * GAPY;
      positions[id] = { x, y };
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      // Queue connected nodes
      edges.filter(e => e.from === id).forEach((e, i) => {
        if (!visited.has(e.to)) {
          queue.push({ id: e.to, depth: depth + 1, lane: i });
        }
      });
    }

    // Position any unvisited nodes
    allIds.forEach(id => {
      if (!positions[id]) {
        maxY += GAPY;
        positions[id] = { x: PAD, y: maxY };
      }
    });

    // Build output arrays
    const nodesArr = allIds.map(id => {
      const pos = positions[id] || { x: PAD, y: PAD };
      const n = nodes[id] || pseudoNodes[id] || {};
      return {
        id,
        x: pos.x,
        y: pos.y,
        w: W,
        h: H,
        label: n.speaker || n.label || id,
        type: n.type || (id === this.graph.start ? "start" : "normal"),
        isStart: id === this.graph.start
      };
    });

    const edgesArr = edges.map(e => {
      const from = positions[e.from] || { x: 0, y: 0 };
      const to = positions[e.to] || { x: 0, y: 0 };
      return {
        x1: from.x + W,
        y1: from.y + H / 2,
        x2: to.x,
        y2: to.y + H / 2,
        label: e.label,
        runOn: e.runOn || "always"
      };
    });

    this.layout = { width: maxX + PAD + W + 40, height: maxY + PAD + H + 40 };

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

    const svg = html.find("svg")[0];
    if (!svg) return;

    let view = { x: 0, y: 0, k: 1 };
    const apply = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${this.layout.width / view.k} ${this.layout.height / view.k}`);
    apply();

    // Pan with middle mouse
    let dragging = false, last = null;
    svg.addEventListener("mousedown", (ev) => {
      if (ev.button !== 1) return;
      dragging = true;
      last = { x: ev.clientX, y: ev.clientY };
      ev.preventDefault();
    });
    window.addEventListener("mouseup", () => dragging = false);
    window.addEventListener("mousemove", (ev) => {
      if (!dragging) return;
      const dx = (ev.clientX - last.x) * (1 / view.k);
      const dy = (ev.clientY - last.y) * (1 / view.k);
      view.x -= dx;
      view.y -= dy;
      last = { x: ev.clientX, y: ev.clientY };
      apply();
    });

    // Zoom with Ctrl+wheel
    svg.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const d = Math.sign(ev.deltaY);
      view.k = Math.max(0.25, Math.min(2.5, view.k * (d > 0 ? 0.9 : 1.1)));
      apply();
    });
  }
}

window.DialogueGraphWindow = DialogueGraphWindow;