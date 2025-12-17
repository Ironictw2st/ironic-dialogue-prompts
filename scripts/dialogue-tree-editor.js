// Visual Dialogue Tree Editor - Interactive graph-based dialogue editing
// Allows GM to click nodes to edit, drag to reposition, and connect nodes visually

class DialogueTreeEditor extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ironic-dialogue-tree-editor",
      classes: ["ironic-dialogue", "tree-editor"],
      template: "modules/ironic-dialogue-prompts/templates/dialogue-tree-editor.hbs",
      width: 1200,
      height: 800,
      resizable: true,
      title: "Dialogue Tree Editor"
    });
  }

  constructor(npc, opts = {}) {
    super();
    this.npc = npc;
    this.dataModel = { start: "start", nodes: {} };
    this._loaded = false;
    this._dirty = false;
    
    // Visual state
    this.nodePositions = {}; // { nodeId: { x, y } }
    this.selectedNode = null;
    this.view = { x: 0, y: 0, k: 1 };
    
    // Drag state
    this._dragging = null;
    this._connecting = null;
    this._panStart = null;
  }

  async _ensureLoaded() {
    if (this._loaded) return;

    const doc = this._getStoreDoc();
    const raw = await doc.getFlag('ironic-dialogue-prompts', 'dialogue') ?? {};
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
      base.nodes[base.start] = { id: base.start, speaker: this.npc.name, text: "Hello there...", options: [] };
    }

    this.dataModel = base;
    
    // Load saved positions or compute layout
    const savedPositions = await doc.getFlag('ironic-dialogue-prompts', 'nodePositions');
    if (savedPositions) {
      this.nodePositions = foundry.utils.duplicate(savedPositions);
    }
    this._computeLayout();
    
    this._loaded = true;
    this._dirty = false;
  }

  _computeLayout() {
    const nodes = this.dataModel.nodes;
    const start = this.dataModel.start;
    
    // Build edges for layout computation
    const edges = [];
    for (const [nid, node] of Object.entries(nodes)) {
      const options = Array.isArray(node.options) ? node.options : [];
      options.forEach(o => {
        let target = (o.next || "").trim();
        if (!target && Array.isArray(o.results)) {
          for (const r of o.results) {
            const t = (r?.type || "").toLowerCase();
            if (t === "goto" && r.value) { target = String(r.value); break; }
          }
        }
        if (target && target !== "END" && target !== "end" && nodes[target]) {
          edges.push({ from: nid, to: target });
        }
      });
    }

    // BFS layered layout
    const layers = new Map();
    const q = [start];
    layers.set(start, 0);

    while (q.length) {
      const cur = q.shift();
      const d = layers.get(cur);
      for (const e of edges.filter(x => x.from === cur)) {
        if (!layers.has(e.to)) {
          layers.set(e.to, d + 1);
          q.push(e.to);
        }
      }
    }

    // Place unlayered nodes
    const maxL = layers.size ? Math.max(...layers.values()) : 0;
    for (const id of Object.keys(nodes)) {
      if (!layers.has(id)) layers.set(id, maxL + 1);
    }

    // Group by layer
    const grouped = {};
    for (const [id, l] of layers.entries()) {
      grouped[l] ||= [];
      grouped[l].push(id);
    }

    // Assign positions (only for nodes without saved positions)
    const H_GAP = 200, V_GAP = 150, PAD = 100;
    const layerKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);

    for (const l of layerKeys) {
      const ids = grouped[l].sort();
      ids.forEach((id, i) => {
        if (!this.nodePositions[id]) {
          this.nodePositions[id] = {
            x: PAD + i * H_GAP,
            y: PAD + l * V_GAP
          };
        }
      });
    }
  }

  async getData() {
    await this._ensureLoaded();

    // Color palette for nodes
    const nodeColors = [
      { bg: '#2e7d32', border: '#4caf50' }, // green (start)
      { bg: '#1565c0', border: '#42a5f5' }, // blue
      { bg: '#6a1b9a', border: '#ab47bc' }, // purple
      { bg: '#c62828', border: '#ef5350' }, // red
      { bg: '#ef6c00', border: '#ffa726' }, // orange
      { bg: '#00838f', border: '#26c6da' }, // cyan
      { bg: '#4527a0', border: '#7e57c2' }, // deep purple
      { bg: '#2e7d32', border: '#66bb6a' }, // green
      { bg: '#ad1457', border: '#ec407a' }, // pink
      { bg: '#283593', border: '#5c6bc0' }, // indigo
    ];

    const nodeIds = Object.keys(this.dataModel.nodes);
    const nodes = nodeIds.map((id, idx) => {
      const node = this.dataModel.nodes[id];
      const isStart = id === this.dataModel.start;
      const colorIdx = isStart ? 0 : ((idx % (nodeColors.length - 1)) + 1);
      
      // Process options to determine their target type and port positions
      const rawOptions = node.options || [];
      const optCount = rawOptions.length;
      
      // Node dimensions for port positioning
      const nodeW = 70;  // half width
      const nodeH = 35;  // half height
      const portRadius = 6;
      
      const options = rawOptions.map((o, optIdx) => {
        let target = (o.next || "").trim();
        let targetType = "node"; // default
        
        if (!target && Array.isArray(o.results)) {
          for (const r of o.results) {
            const t = (r?.type || "").toLowerCase();
            if (t === "goto" && r.value) { target = String(r.value); break; }
            if (t === "opentrade" || t === "ironicshop" || t === "openshop") { targetType = "shop"; break; }
            if (t === "startcombat" || t === "startfight") { targetType = "combat"; break; }
            if (t === "ends") { targetType = "end"; break; }
          }
        }
        
        if (target === "END" || target === "end") { targetType = "end"; }
        
        // If no target and no special result, it's a "stay" (no connection)
        if (!target && targetType === "node") { targetType = "stay"; }
        
        // Calculate port position around the node edge
        let portX, portY, labelX, labelY;
        
        if (optCount <= 5) {
          // Simple vertical layout on right edge
          // Fixed spacing of 36px between ports, centered vertically
          const spacing = 36;
          const totalHeight = (optCount - 1) * spacing;
          const startY = -totalHeight / 2;
          portX = nodeW + 8; // Slightly outside the node edge
          portY = startY + optIdx * spacing;
          labelX = portX + 14;
          labelY = portY + 4;
        } else {
          // Distribute around the right half of the node (elliptical)
          // Angle from -90° to +90° (right side of ellipse)
          const angleRange = 180; // degrees
          const startAngle = -90;
          const angleStep = angleRange / (optCount - 1 || 1);
          const angle = (startAngle + optIdx * angleStep) * Math.PI / 180;
          
          // Ellipse with larger radius for more spacing
          const rx = nodeW + 20;
          const ry = nodeH + 20;
          
          portX = Math.cos(angle) * rx;
          portY = Math.sin(angle) * ry;
          
          // Label position - further out from the port
          labelX = portX + (portX > 0 ? 10 : -30);
          labelY = portY + 4;
        }
        
        // Determine if this option needs a roll (skill check or ability check with roll flag)
        const req = o.requirement;
        const needsRoll = req && (
          req.type === "skill" || 
          (req.type === "ability" && req.roll)
        );
        
        return { 
          ...o, 
          target, 
          targetType, 
          portX, 
          portY, 
          labelX, 
          labelY,
          needsRoll
        };
      });
      
      return {
        id,
        ...node,
        options, // Use processed options with targetType and positions
        x: this.nodePositions[id]?.x ?? 100,
        y: this.nodePositions[id]?.y ?? 100,
        isStart,
        isSelected: id === this.selectedNode,
        colorIdx,
        colorBg: nodeColors[colorIdx].bg,
        colorBorder: nodeColors[colorIdx].border
      };
    });

    // Build edges (option connections + goto results)
    const edges = [];
    const _normKind = (k) => (k === "pass" || k === "fail") ? k : "always";

    for (const n of nodes) {
      (n.options || []).forEach((o, idx) => {
        // We only draw edges that land on real dialogue nodes
        if (o.targetType !== "node") return;

        const fromNodePos = this.nodePositions[n.id] || { x: 0, y: 0 };

        // Edge starts from the port position (relative to node center)
        const x1 = fromNodePos.x + (o.portX || 70);
        const y1 = fromNodePos.y + (o.portY || 0);

        /** @type {{to:string, kind:'always'|'pass'|'fail', label:string}[]} */
        const targets = [];

        // 1) Direct Next Node (always)
        const direct = (o.next || "").trim();
        if (direct && direct !== "END" && direct !== "end" && this.dataModel.nodes[direct]) {
          targets.push({
            to: direct,
            kind: "always",
            label: o.label || `Option ${idx + 1}`
          });
        } else if (Array.isArray(o.results)) {
          // 2) Goto results (can be multiple: pass/fail/always)
          for (const r of o.results) {
            const t = String(r?.type || "").toLowerCase();
            if (t !== "goto") continue;
            const val = r?.value ? String(r.value).trim() : "";
            if (!val || !this.dataModel.nodes[val]) continue;

            const kind = _normKind((r?.on || "").toLowerCase());
            const baseLabel = o.label || `Option ${idx + 1}`;
            const suffix = kind === "pass" ? " ✓" : (kind === "fail" ? " ✗" : "");
            targets.push({ to: val, kind, label: baseLabel + suffix });
          }
        }

        // Deduplicate (same target+kind)
        const seen = new Set();
        for (const tgt of targets) {
          const key = `${tgt.to}::${tgt.kind}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const toNodePos = this.nodePositions[tgt.to] || { x: fromNodePos.x + 180, y: fromNodePos.y };

          // Edge ends at the left side of the target node
          const x2 = toNodePos.x - 70;
          const y2 = toNodePos.y;

          // Label position - 35% along the line, offset perpendicular
          const midX = x1 + (x2 - x1) * 0.35;
          const midY = y1 + (y2 - y1) * 0.35;

          // Perpendicular offset for label (separate multiple edges)
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const baseOff = 12;

          // If multiple targets from same option, spread labels/lines slightly
          const ix = Array.from(seen).length; // 1..N
          const spread = (ix - 1) * 6;

          const perpX = (-dy / len) * (baseOff + spread);
          const perpY = ( dx / len) * (baseOff + spread);

          edges.push({
            from: n.id,
            to: tgt.to,
            kind: tgt.kind,
            label: tgt.label,
            optionId: o.id,
            x1,
            y1,
            x2,
            y2,
            labelX: midX + perpX,
            labelY: midY + perpY
          });
        }
      });
    }

// Calculate SVG dimensions
    let maxX = 400, maxY = 300;
    for (const pos of Object.values(this.nodePositions)) {
      maxX = Math.max(maxX, pos.x + 150);
      maxY = Math.max(maxY, pos.y + 100);
    }

    // Get selected node details for the panel
    const selectedNodeData = this.selectedNode ? this.dataModel.nodes[this.selectedNode] : null;
    const allNodeIds = Object.keys(this.dataModel.nodes);

    // Process selectedNode options to add needsRoll
    let selectedNodeWithRoll = null;
    if (selectedNodeData) {
      const processedOptions = (selectedNodeData.options || []).map(o => {
        const req = o.requirement;
        const needsRoll = req && (
          req.type === "skill" || 
          (req.type === "ability" && req.roll)
        );
        return { ...o, needsRoll };
      });
      selectedNodeWithRoll = { 
        id: this.selectedNode, 
        ...selectedNodeData, 
        options: processedOptions 
      };
    }

    return {
      npcName: this.npc.name,
      nodes,
      edges,
      width: maxX,
      height: maxY,
      start: this.dataModel.start,
      selectedNode: selectedNodeWithRoll,
      allNodeIds,
      dirty: this._dirty
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const svg = html.find("svg.tree-canvas")[0];
    const wrapper = html.find(".canvas-wrapper")[0];
    if (!svg || !wrapper) return;

    // Restore panel scroll position if saved
    const panel = html.find(".edit-panel")[0];
    if (panel && this._panelScrollTop !== undefined) {
      panel.scrollTop = this._panelScrollTop;
    }

    // Initialize view
    this._applyView(svg);

    // === SVG Pan & Zoom ===
    svg.addEventListener("mousedown", (ev) => {
      if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
        // Middle mouse or Shift+Left for panning
        this._panStart = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y };
        ev.preventDefault();
      }
    });

    window.addEventListener("mousemove", (ev) => {
      if (this._panStart) {
        const dx = (ev.clientX - this._panStart.x) / this.view.k;
        const dy = (ev.clientY - this._panStart.y) / this.view.k;
        this.view.x = this._panStart.vx - dx;
        this.view.y = this._panStart.vy - dy;
        this._applyView(svg);
      }
      
      if (this._dragging) {
        const rect = svg.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / this.view.k + this.view.x;
        const y = (ev.clientY - rect.top) / this.view.k + this.view.y;
        this.nodePositions[this._dragging] = { x, y };
        this._dirty = true;
        this._updateNodePosition(html, this._dragging, x, y);
      }
      
      if (this._connecting) {
        const rect = svg.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / this.view.k + this.view.x;
        const y = (ev.clientY - rect.top) / this.view.k + this.view.y;
        this._updateConnectLine(html, x, y);
      }
    });

    window.addEventListener("mouseup", (ev) => {
      if (this._panStart) {
        this._panStart = null;
      }
      
      if (this._dragging) {
        this._dragging = null;
        this.render(false); // Soft re-render to update edges
      }
      
      if (this._connecting) {
        // Check if we dropped on a node
        const target = ev.target.closest('.tree-node');
        if (target && target.dataset.id !== this._connecting.from) {
          this._createConnection(this._connecting.from, this._connecting.optionId, target.dataset.id);
        }
        this._connecting = null;
        html.find(".connect-line").attr("x2", 0).attr("y2", 0).hide();
      }
    });

    svg.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const d = Math.sign(ev.deltaY);
      const oldK = this.view.k;
      this.view.k = Math.max(0.25, Math.min(2.5, this.view.k * (d > 0 ? 0.9 : 1.1)));
      
      // Zoom toward cursor
      const rect = svg.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      this.view.x += mx * (1/oldK - 1/this.view.k);
      this.view.y += my * (1/oldK - 1/this.view.k);
      
      this._applyView(svg);
    });

    // === Node Interactions ===
    html.on("mousedown", ".tree-node", (ev) => {
      if (ev.button !== 0 || ev.shiftKey) return;
      const id = ev.currentTarget.dataset.id;
      
      // Double-click to edit
      if (ev.detail === 2) {
        this.selectedNode = id;
        this.render(true);
        return;
      }
      
      // Single click + drag to move
      this._dragging = id;
      ev.preventDefault();
      ev.stopPropagation();
    });

    html.on("click", ".tree-node", (ev) => {
      const id = ev.currentTarget.dataset.id;
      this.selectedNode = id;
      this.render(true);
    });

    // === Connection dragging from option ports ===
    html.on("mousedown", ".option-port", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const nodeId = ev.currentTarget.dataset.nid;
      const optId = ev.currentTarget.dataset.oid;
      this._connecting = { from: nodeId, optionId: optId };
      html.find(".connect-line").show();
    });

    // === Panel Interactions ===
    // Node text editing
    html.on("input", ".panel-node-text", (ev) => {
      if (!this.selectedNode) return;
      this.dataModel.nodes[this.selectedNode].text = ev.currentTarget.value;
      this._dirty = true;
    });

    html.on("input", ".panel-node-speaker", (ev) => {
      if (!this.selectedNode) return;
      this.dataModel.nodes[this.selectedNode].speaker = ev.currentTarget.value;
      this._dirty = true;
    });

    // Rename node
    html.on("change", ".panel-node-id", (ev) => {
      const oldId = this.selectedNode;
      const newId = ev.currentTarget.value.trim();
      if (!newId || newId === oldId) return;
      if (this.dataModel.nodes[newId]) {
        ui.notifications.warn("A node with that ID already exists.");
        ev.currentTarget.value = oldId;
        return;
      }
      this._renameNode(oldId, newId);
    });

    // Option editing
    html.on("input", ".panel-opt-label", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const opt = this._getOption(this.selectedNode, oid);
      if (opt) {
        opt.label = ev.currentTarget.value;
        this._dirty = true;
      }
    });

    html.on("change", ".panel-opt-next", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const opt = this._getOption(this.selectedNode, oid);
      if (opt) {
        opt.next = ev.currentTarget.value;
        this._dirty = true;
        this._renderPreserveScroll();
      }
    });

    // Hidden checkbox handler
    html.on("change", ".panel-opt-hidden", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const opt = this._getOption(this.selectedNode, oid);
      if (opt) {
        opt.hidden = ev.currentTarget.checked;
        this._dirty = true;
      }
    });

    // Add/remove options
    html.on("click", "[data-action='add-option']", () => {
      if (!this.selectedNode) return;
      const node = this.dataModel.nodes[this.selectedNode];
      if (!node.options) node.options = [];
      
      const makeId = foundry?.utils?.randomID?.bind(foundry.utils) ||
        (() => Math.random().toString(36).slice(2, 10));
      
      node.options.push({
        id: makeId(),
        label: "New Option",
        next: "",
        requirement: null,
        results: [],
        onPass: [],
        onFail: [],
        hidden: false
      });
      this._dirty = true;
      this._renderPreserveScroll();
    });

    html.on("click", "[data-action='del-option']", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      if (!this.selectedNode) return;
      const node = this.dataModel.nodes[this.selectedNode];
      node.options = (node.options || []).filter(o => o.id !== oid);
      this._dirty = true;
      this._renderPreserveScroll();
    });

    // === Toolbar Actions ===
    html.on("click", "[data-action='add-node']", () => {
      const makeId = foundry?.utils?.randomID?.bind(foundry.utils) ||
        (() => Math.random().toString(36).slice(2, 10));
      
      const id = makeId();
      this.dataModel.nodes[id] = {
        id,
        speaker: this.npc.name,
        text: "New dialogue node...",
        options: []
      };
      
      // Position near center of view
      this.nodePositions[id] = {
        x: this.view.x + 300,
        y: this.view.y + 200
      };
      
      this._dirty = true;
      this.selectedNode = id;
      this.render(true);
    });

    html.on("click", "[data-action='delete-node']", () => {
      if (!this.selectedNode) return;
      if (this.selectedNode === this.dataModel.start) {
        ui.notifications.warn("Cannot delete the start node.");
        return;
      }
      
      new Dialog({
        title: `Delete node "${this.selectedNode}"?`,
        content: `<p>This will remove the node and clear any options pointing to it.</p>`,
        buttons: {
          del: {
            icon: '<i class="fas fa-trash"></i>',
            label: "Delete",
            callback: async () => await this._deleteNode(this.selectedNode)
          },
          cancel: { label: "Cancel" }
        },
        default: "cancel"
      }).render(true);
    });

    html.on("click", "[data-action='set-start']", () => {
      if (!this.selectedNode) return;
      this.dataModel.start = this.selectedNode;
      this._dirty = true;
      this.render(true);
    });

    html.on("click", "[data-action='save']", () => this._save());
    
    html.on("click", "[data-action='preview']", async () => {
      const nodeIds = Object.keys(this.dataModel.nodes);
      if (nodeIds.length === 0) {
        ui.notifications.warn("No nodes to preview");
        return;
      }
      
      // Build options for the dialog
      const nodeOptions = nodeIds.map(id => {
        const node = this.dataModel.nodes[id];
        const isStart = id === this.dataModel.start;
        const preview = node.text ? node.text.substring(0, 40) + (node.text.length > 40 ? "..." : "") : "(empty)";
        return `<option value="${id}" ${isStart ? 'selected' : ''}>${foundry.utils.escapeHTML(id)}${isStart ? ' (START)' : ''} - ${foundry.utils.escapeHTML(preview)}</option>`;
      }).join("");
      
      const content = `
        <form>
          <div class="form-group">
            <label>Select starting node to preview:</label>
            <select name="start-node" style="width: 100%;">
              ${nodeOptions}
            </select>
          </div>
        </form>
      `;
      
      const startNode = await Dialog.prompt({
        title: "Preview Dialogue",
        content,
        label: "Preview",
        callback: (html) => html.find('[name="start-node"]').val(),
        rejectClose: false
      });
      
      if (!startNode) return;
      
      // Create a modified dialogue model with the selected start node
      const previewModel = foundry.utils.duplicate(this.dataModel);
      previewModel.start = startNode;
      
      new DialoguePromptWindow(this.npc, { dialogueNodes: previewModel }, null).render(true);
    });

    html.on("click", "[data-action='open-editor']", () => {
      new DialogueEditor(this.npc, { mode: "edit" }).render(true);
    });

    html.on("click", "[data-action='fit-view']", () => {
      this._fitView(svg);
    });

    html.on("click", "[data-action='auto-layout']", () => {
      this.nodePositions = {};
      this._computeLayout();
      this._dirty = true;
      this.render(true);
    });

    // Close panel
    html.on("click", "[data-action='close-panel']", () => {
      this.selectedNode = null;
      this.render(true);
    });

    // === Requirement type changes ===
    // === Requirement type changes ===
    html.on("change", ".panel-req-type", (ev) => {
    const oid = ev.currentTarget.dataset.oid;
    const opt = this._getOption(this.selectedNode, oid);
    if (!opt) return;
    
    const type = ev.currentTarget.value;
    if (!type) {
        opt.requirement = null;
    } else {
        // Initialize with defaults based on type
        switch (type) {
        case "ability":
            opt.requirement = { type, key: "str", value: 10 };
            break;
        case "skill":
            opt.requirement = { type, key: "acr", value: 10 };
            break;
        case "race":
            opt.requirement = { type, value: "" };
            break;
        case "language":
            opt.requirement = { type, value: "" };
            break;
        case "spell":
            opt.requirement = { type, value: "" };
            break;
        case "item":
            opt.requirement = { type, value: "" };
            break;
        case "flag":
            opt.requirement = { type, key: "", value: "", op: ">=" };
            break;
        case "gmonly":
            opt.requirement = { type };
            break;
        default:
            opt.requirement = { type };
        }
    }
    
    this._dirty = true;
    this._renderPreserveScroll();
});

    // Requirement field changes
    html.on("change input", ".panel-req-field", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const field = ev.currentTarget.dataset.field;
      const opt = this._getOption(this.selectedNode, oid);
      if (!opt || !opt.requirement) return;
      
      let val;
      if (ev.currentTarget.type === "checkbox") {
        val = ev.currentTarget.checked;
      } else if (ev.currentTarget.type === "number") {
        val = Number(ev.currentTarget.value);
      } else {
        val = ev.currentTarget.value;
      }
      
      opt.requirement[field] = val;
      this._dirty = true;
    });

    // === Result actions ===
    html.on("click", ".panel-res-add", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const opt = this._getOption(this.selectedNode, oid);
      if (!opt) return;
      if (!opt.results) opt.results = [];
      opt.results.push({ type: "goto", value: "" });
      this._dirty = true;
      this._renderPreserveScroll();
    });

    html.on("click", ".panel-res-del", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const opt = this._getOption(this.selectedNode, oid);
      if (!opt || !opt.results) return;
      opt.results.splice(ridx, 1);
      this._dirty = true;
      this._renderPreserveScroll();
    });

    html.on("change", ".panel-res-type", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const opt = this._getOption(this.selectedNode, oid);
      if (!opt || !opt.results) return;
      opt.results[ridx] = { type: ev.currentTarget.value };
      this._dirty = true;
      this._renderPreserveScroll();
    });

    html.on("change input", ".panel-res-field", (ev) => {
      const oid = ev.currentTarget.dataset.oid;
      const ridx = Number(ev.currentTarget.dataset.ridx);
      const field = ev.currentTarget.dataset.field;
      const opt = this._getOption(this.selectedNode, oid);
      if (!opt || !opt.results || !opt.results[ridx]) return;
      
      let val = ev.currentTarget.value;
      if (ev.currentTarget.type === "number") val = Number(val);
      
      opt.results[ridx][field] = val;
      this._dirty = true;
    });

    // === Export/Import/Presets ===
    html.on("click", "[data-action='export-json']", () => this._exportJSON());
    html.on("click", "[data-action='import-json']", () => this._importJSON());
    html.on("click", "[data-action='presets']", () => this._openPresetsDialog());
  }

  // === Helper Methods ===
  
  _applyView(svg) {
    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 600;
    svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${w/this.view.k} ${h/this.view.k}`);
  }

  _fitView(svg) {
    const positions = Object.values(this.nodePositions);
    if (!positions.length) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x - 60);
      minY = Math.min(minY, p.y - 30);
      maxX = Math.max(maxX, p.x + 60);
      maxY = Math.max(maxY, p.y + 30);
    }
    
    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 600;
    const padding = 50;
    
    const scaleX = (w - padding * 2) / (maxX - minX);
    const scaleY = (h - padding * 2) / (maxY - minY);
    this.view.k = Math.min(scaleX, scaleY, 2);
    this.view.x = minX - padding / this.view.k;
    this.view.y = minY - padding / this.view.k;
    
    this._applyView(svg);
  }

  _updateNodePosition(html, nodeId, x, y) {
    // Update node position
    const nodeEl = html.find(`.tree-node[data-id="${nodeId}"]`);
    nodeEl.attr("transform", `translate(${x},${y})`);
    
    // Update connected edges (quick visual update)
    html.find(`.tree-edge[data-from="${nodeId}"]`).each((_, el) => {
      el.setAttribute("x1", x);
      el.setAttribute("y1", y);
    });
    html.find(`.tree-edge[data-to="${nodeId}"]`).each((_, el) => {
      el.setAttribute("x2", x);
      el.setAttribute("y2", y);
    });
  }

  _updateConnectLine(html, x, y) {
    const line = html.find(".connect-line");
    const fromPos = this.nodePositions[this._connecting.from];
    line.attr("x1", fromPos.x).attr("y1", fromPos.y);
    line.attr("x2", x).attr("y2", y);
  }

  _getOption(nodeId, optId) {
    const node = this.dataModel.nodes[nodeId];
    if (!node) return null;
    return (node.options || []).find(o => o.id === optId);
  }

  _createConnection(fromNodeId, optionId, toNodeId) {
    const opt = this._getOption(fromNodeId, optionId);
    if (opt) {
      opt.next = toNodeId;
      this._dirty = true;
      this.render(true);
    }
  }

  _renameNode(oldId, newId) {
    const nodes = this.dataModel.nodes;
    
    // Move node data
    nodes[newId] = nodes[oldId];
    nodes[newId].id = newId;
    delete nodes[oldId];
    
    // Move position
    if (this.nodePositions[oldId]) {
      this.nodePositions[newId] = this.nodePositions[oldId];
      delete this.nodePositions[oldId];
    }
    
    // Update start reference
    if (this.dataModel.start === oldId) {
      this.dataModel.start = newId;
    }
    
    // Update all references
    for (const n of Object.values(nodes)) {
      (n.options || []).forEach(o => {
        if (o.next === oldId) o.next = newId;
        if (Array.isArray(o.results)) {
          o.results.forEach(r => {
            if ((r?.type || "").toLowerCase() === "goto" && r.value === oldId) {
              r.value = newId;
            }
          });
        }
      });
    }
    
    this.selectedNode = newId;
    this._dirty = true;
    this.render(true);
  }

  async _deleteNode(nodeId) {
    const nodes = this.dataModel.nodes ?? {};

    // Remove node + its saved position
    delete nodes[nodeId];
    delete this.nodePositions[nodeId];

    // Reassign start if needed
    if (this.dataModel.start === nodeId) {
        const remaining = Object.keys(nodes);
        this.dataModel.start = remaining[0] || "start";

        if (!nodes[this.dataModel.start]) {
        nodes[this.dataModel.start] = {
            id: this.dataModel.start,
            speaker: this.npc.name,
            text: "",
            options: []
        };
        }
    }

    // Remove references to deleted node
    for (const n of Object.values(nodes)) {
        (n.options || []).forEach(o => {
        if (o.next === nodeId) o.next = "";
        if (Array.isArray(o.results)) {
            o.results = o.results.filter(r => {
            const t = (r?.type || "").toLowerCase();
            return t !== "goto" || r.value !== nodeId;
            });
        }
        });
    }

    this.selectedNode = null;
    this._dirty = true;

    await this._save();
    ui.notifications.info(`Deleted node "${nodeId}" and saved.`);


    this.render(true);
    }


  async _save() {
    const MODULE_ID = "ironic-dialogue-prompts";
    const doc = this._getStoreDoc();
    
    const saveData = { dialogueNodes: this.dataModel, nodes: null, start: null };
    
    // Unset first to avoid deep merge issues with deleted nodes
    await doc.unsetFlag(MODULE_ID, 'dialogue');
    await doc.setFlag(MODULE_ID, 'dialogue', saveData);
    
    // Also save positions (these can use setFlag directly since we're not deleting keys)
    await doc.setFlag(MODULE_ID, 'nodePositions', this.nodePositions);

    this._dirty = false;
    ui.notifications.info("Dialogue tree saved.");
    this.render(true);
    }



  /** Render while preserving the panel scroll position */
  _renderPreserveScroll() {
    const panel = this.element?.find?.(".edit-panel")?.[0];
    if (panel) {
      this._panelScrollTop = panel.scrollTop;
    }
    this.render(true);
  }

  async close(options = {}) {
    if (this._dirty) {
      const confirm = await Dialog.confirm({
        title: "Unsaved Changes",
        content: "<p>You have unsaved changes. Discard them?</p>",
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
      if (!confirm) return;
    }
    return super.close(options);
  }

  _getStoreDoc() {
    // If this is a token actor, store on the TokenDocument (persists for that placed token)
    if (this.npc?.isToken && this.npc?.token?.document) return this.npc.token.document;
    // Otherwise store on the Actor
    return this.npc;
  }

  // === Export/Import/Presets ===
  
  _exportJSON() {
    const exportData = {
      version: 1,
      npcName: this.npc.name,
      exportedAt: new Date().toISOString(),
      dialogue: foundry.utils.duplicate(this.dataModel),
      nodePositions: foundry.utils.duplicate(this.nodePositions)
    };
    
    const filename = `dialogue-${this.npc.name.replace(/[^a-z0-9]/gi, "_")}.json`;
    this._downloadJSON(exportData, filename);
    ui.notifications.info("Dialogue exported successfully!");
  }

  _downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    
    // Use Foundry's built-in save method if available
    if (typeof saveDataToFile === 'function') {
      saveDataToFile(jsonStr, 'application/json', filename);
    } else {
      // Fallback for older versions
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // Use setTimeout to ensure the click happens properly
      setTimeout(() => {
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    }
  }

  async _importJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (!data.dialogue || !data.dialogue.nodes) {
          ui.notifications.error("Invalid dialogue file format");
          return;
        }
        
        const confirm = await Dialog.confirm({
          title: "Import Dialogue",
          content: `<p>Import dialogue from "${file.name}"? This will replace the current dialogue.</p>`,
          yes: () => true,
          no: () => false
        });
        
        if (!confirm) return;
        
        this.dataModel = foundry.utils.duplicate(data.dialogue);
        this.nodePositions = data.nodePositions || {};
        this._dirty = true;
        this.render(true);
        
        ui.notifications.info("Dialogue imported successfully!");
      } catch (err) {
        console.error("Import error:", err);
        ui.notifications.error("Failed to import dialogue: " + err.message);
      }
    };
    
    input.click();
  }

  async _openPresetsDialog() {
    // Load saved presets from world settings
    let presets = game.settings.get("ironic-dialogue-prompts", "dialogue-presets") || [];
    
    const presetOptions = presets.map((p, i) => 
      `<option value="${i}">${foundry.utils.escapeHTML(p.name)} (${new Date(p.savedAt).toLocaleDateString()})</option>`
    ).join("");
    
    const content = `
      <form>
        <div style="margin-bottom: 12px;">
          <h3 style="margin-bottom: 8px;">Load Preset</h3>
          ${presets.length > 0 ? `
            <div style="margin-bottom: 8px;">
              <select name="preset-select" style="width: 100%;">
                <option value="">Select a preset...</option>
                ${presetOptions}
              </select>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="preset-load-btn" style="flex: 3; padding: 6px 12px;"><i class="fas fa-download"></i> Load Selected</button>
              <button type="button" class="preset-delete-btn" style="flex: 1; background: #e74c3c; color: white; padding: 6px 12px;"><i class="fas fa-trash"></i></button>
            </div>
          ` : `<p style="color: #888;">No presets saved yet.</p>`}
        </div>
        <hr>
        <div style="margin-top: 12px;">
          <h3 style="margin-bottom: 8px;">Save Current as Preset</h3>
          <div style="margin-bottom: 8px;">
            <input type="text" name="preset-name" placeholder="Enter preset name..." style="width: 100%;">
          </div>
          <button type="button" class="preset-save-btn" style="width: 100%; padding: 6px 12px;"><i class="fas fa-save"></i> Save as New Preset</button>
        </div>
      </form>
    `;
    
    const self = this;
    
    new Dialog({
      title: "Dialogue Presets",
      content,
      buttons: {
        close: { icon: '<i class="fas fa-times"></i>', label: "Close" }
      },
      render: (html) => {
        // Load preset button
        html.find(".preset-load-btn").on("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const selectVal = html.find('[name="preset-select"]').val();
          const idx = Number(selectVal);
          if (selectVal === "" || isNaN(idx) || !presets[idx]) {
            ui.notifications.warn("Please select a preset first");
            return;
          }
          
          const doLoad = await Dialog.confirm({
            title: "Load Preset",
            content: `<p>Load preset "${presets[idx].name}"? This will replace the current dialogue.</p>`
          });
          if (!doLoad) return;
          
          self.dataModel = foundry.utils.duplicate(presets[idx].dialogue);
          self.nodePositions = presets[idx].nodePositions || {};
          self._dirty = true;
          self.render(true);
          ui.notifications.info("Preset loaded!");
        });
        
        // Delete preset button
        html.find(".preset-delete-btn").on("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const selectVal = html.find('[name="preset-select"]').val();
          const idx = Number(selectVal);
          if (selectVal === "" || isNaN(idx) || !presets[idx]) {
            ui.notifications.warn("Please select a preset first");
            return;
          }
          
          const doDelete = await Dialog.confirm({
            title: "Delete Preset",
            content: `<p>Delete preset "${presets[idx].name}"?</p>`
          });
          if (!doDelete) return;
          
          presets.splice(idx, 1);
          await game.settings.set("ironic-dialogue-prompts", "dialogue-presets", presets);
          ui.notifications.info("Preset deleted!");
          self._openPresetsDialog(); // Reopen to refresh
        });
        
        // Save preset button
        html.find(".preset-save-btn").on("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const name = html.find('[name="preset-name"]').val()?.trim();
          if (!name) {
            ui.notifications.warn("Please enter a preset name");
            return;
          }
          
          presets.push({
            name,
            savedAt: new Date().toISOString(),
            dialogue: foundry.utils.duplicate(self.dataModel),
            nodePositions: foundry.utils.duplicate(self.nodePositions)
          });
          
          await game.settings.set("ironic-dialogue-prompts", "dialogue-presets", presets);
          ui.notifications.info(`Preset "${name}" saved!`);
        });
      },
      default: "close"
    }, { width: 400 }).render(true);
  }
}

window.DialogueTreeEditor = DialogueTreeEditor;