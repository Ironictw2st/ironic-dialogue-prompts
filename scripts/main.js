// ============================================
// Scene controls (adds: Dialogue, Dialogue (GM))
// ============================================
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.settings.get('ironic-dialogue-prompts', 'enable-prompts')) return;

  if (controls.ironic_options) {
    controls.ironic_options.tools.push({
      name: "ironic-dialogue",
      title: "Dialogue Mode",
      icon: "fas fa-comments",
    });

    controls.ironic_options.tools.push({
      name: "ironic-dialogue-edit",
      title: "Dialogue Mode (GM)",
      icon: "fas fa-user-pen",
      visible: game.user.isGM
    });
  }
});

Hooks.on('renderSceneControls', (controls, html, data) => {
  if (!game.settings.get('ironic-dialogue-prompts', 'enable-prompts')) return;

  // --- Player-facing: target-based talk button ---
  const dialogueButton = html.querySelector('[data-tool="ironic-dialogue"]');
  if (dialogueButton && !dialogueButton.dataset.bound) {
    dialogueButton.dataset.bound = "true";
    dialogueButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // 1) If user already has a target, use it
      const preTarget = getFirstTargetOfCurrentUser();
      if (preTarget) {
        const pc = getUserPCActor();
        const ok = await openIfNPC(preTarget, (npc) => openDialogue(npc, pc));
        if (ok) return;
      }

      // 2) Optional fallback: controlled or hovered token
      const preFallback = canvas.tokens.controlled[0] || canvas.tokens.placeables.find(t => t.hover);
      if (preFallback) {
        const pc = getUserPCActor();
        const ok = await openIfNPC(preFallback, (npc) => openDialogue(npc, pc));
        if (ok) return;
      }

      // 3) Wait once for next target from THIS user
      ui.notifications.info("Target an NPC token to start dialogue (press T or click the bullseye).");

      const onceTarget = async (token, userId, targeted) => {
        if (userId !== game.user.id || !targeted) return;
        Hooks.off('targetToken', onceTarget);
        const pc = getUserPCActor();
        await openIfNPC(token, (npc) => openDialogue(npc, pc));
      };

      Hooks.on('targetToken', onceTarget);
    });
  }

  // --- GM-only: open editor (accepts target / controlled / hover) ---
  if (!game.user.isGM) return;
  const dialogueEditButton = html.querySelector('[data-tool="ironic-dialogue-edit"]');
  if (dialogueEditButton && !dialogueEditButton.dataset.bound) {
    dialogueEditButton.dataset.bound = "true";
    dialogueEditButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Helper to open the appropriate editor (prefer Tree Editor)
      const openEditor = (actor) => {
        if (window.DialogueTreeEditor) {
          new DialogueTreeEditor(actor).render(true);
        } else {
          new DialogueEditor(actor, { mode: "edit" }).render(true);
        }
      };

      const pre = getTokenCandidate() || canvas.tokens?.controlled?.[0];
      if (pre?.actor?.type === "npc") {
        openEditor(pre.actor);
        return;
      }

      ui.notifications.info("GM: target an NPC token to open the Dialogue Tree Editor.");

      const onceTargetGM = async (token, userId, targeted) => {
        if (userId !== game.user.id || !targeted) return;
        Hooks.off('targetToken', onceTargetGM);
        const a = token?.actor;
        if (!a || a.type !== "npc") return ui.notifications.warn("Please target an NPC.");
        try {
          openEditor(a);
        } catch (err) {
          console.error(err);
          ui.notifications.error("Failed to open Dialogue Editor. See console.");
        }
      };

      Hooks.on('targetToken', onceTargetGM);
    });
  }
});


// =====================
// Helpers
// =====================
function isPCActor(a) {
  if (!a) return false;
  const t = a.type ?? a.document?.type;
  return t === "character" || a.hasPlayerOwner;
}

/** Best-effort PC for current user: assigned → controlled token → any owned character */
function getUserPCActor() {
  if (isPCActor(game.user.character)) return game.user.character;

  const ctrl = canvas.tokens?.controlled?.[0]?.actor;
  if (isPCActor(ctrl)) return ctrl;

  const owned = game.actors
    ?.filter(a => isPCActor(a) && (a.ownership?.[game.user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
  if (owned && owned[0]) return owned[0];

  return null; // preview mode will be used
}

function getFirstTargetOfCurrentUser() {
  const set = game.user?.targets;
  if (!set || set.size === 0) return null;
  return Array.from(set)[0]; // Token
}

// targeted → controlled → hovered
function getTokenCandidate() {
  const tgt = getFirstTargetOfCurrentUser();
  if (tgt) return tgt;
  if (canvas.tokens.controlled.length) return canvas.tokens.controlled[0];
  const hover = canvas.tokens.placeables.find(t => t.hover);
  if (hover) return hover;
  return null;
}

async function openIfNPC(token, openerFn) {
  const actor = token?.actor;
  const type = actor?.type ?? actor?.document?.type;
  if (!actor || type !== "npc") {
    ui.notifications.warn("Please target an NPC token.");
    return false;
  }
  await openerFn(actor);
  return true;
}


// =====================
// Open Dialogue
// =====================
/** Open dialogue with an NPC, optionally with a specific player Actor (PC). */
async function openDialogue(npc, overridePlayerActor = undefined) {
  // Load dialogue data
  let dialogueData = await npc.getFlag('ironic-dialogue-prompts', 'dialogue');
  dialogueData = dialogueData?.dialogueNodes ?? dialogueData;

  if (!dialogueData || !dialogueData.start) {
    ui.notifications.warn(`${npc.name} has no dialogue configured.`);
    if (game.user.isGM) {
      // Prefer Tree Editor for creating new dialogues
      if (window.DialogueTreeEditor) {
        new DialogueTreeEditor(npc).render(true);
      } else {
        new DialogueEditor(npc).render(true);
      }
    }
    return;
  }

  // Resolve player actor robustly (allows preview if none)
  let playerActor = overridePlayerActor ?? getUserPCActor();

  new DialoguePromptWindow(npc, dialogueData, playerActor ?? null).render(true);
}


// =====================
// GM PC selection (unchanged)
// =====================
/** Return [{ id, label, tokenId, actor }] for PC-capable tokens on the current scene */
function getPCChoicesOnCanvas() {
  const pcs = [];
  for (const t of canvas.tokens.placeables) {
    const a = t.actor;
    if (!a) continue;
    const isPC = a.type === "character" || a.hasPlayerOwner;
    if (!isPC) continue;
    pcs.push({
      id: a.id,
      label: `${a.name} ${t.name && t.name !== a.name ? `(${t.name})` : ""}`.trim(),
      tokenId: t.id,
      actor: a
    });
  }
  const byId = new Map();
  for (const e of pcs) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

/** Prompt GM to select a PC actor; resolves to Actor | null (Preview) | undefined (cancel) */
async function promptGMForPCActor(defaultActor = null) {
  const choices = getPCChoicesOnCanvas();
  const noneValue = "__preview__";

  const options = choices.map(c => `<option value="${c.id}">${foundry.utils.escapeHTML(c.label)}</option>`);
  const defaultValue = defaultActor?.id ?? (choices[0]?.id ?? noneValue);

  const content = `
    <form>
      <div class="form-group">
        <label>Run dialogue as which PC?</label>
        <select name="pcActor" style="width:100%">
          <option value="${noneValue}">Preview (no PC / GM)</option>
          ${options.join("")}
        </select>
      </div>
    </form>
  `;

  const result = await Dialog.prompt({
    title: "Choose PC (GM Test)",
    content,
    label: "Use",
    rejectClose: true,
    callback: html => html[0].querySelector('[name="pcActor"]').value
  });

  if (result === undefined) return undefined;  // cancelled
  if (result === noneValue) return null;       // preview
  const picked = choices.find(c => c.id === result);
  return picked?.actor ?? null;                // actor or null
}


// =====================
// Handlebars helpers
// =====================
Hooks.once('init', () => {
  if (!Handlebars.helpers.eq)    Handlebars.registerHelper('eq', (a,b) => a===b);
  if (!Handlebars.helpers.json)  Handlebars.registerHelper('json', (obj) => JSON.stringify(obj ?? "", null, 2));
  if (!Handlebars.helpers.array) Handlebars.registerHelper('array', (...args) => args.slice(0,-1));
  if (!Handlebars.helpers.calcMid)
    Handlebars.registerHelper('calcMid', (a,b,off=0)=>((Number(a)+Number(b))/2 + Number(off)));
  
  // Additional helpers for the tree editor
  // calc: for positioning option ports (base + idx * spacing)
  if (!Handlebars.helpers.calc)
    Handlebars.registerHelper('calc', (base, idx, spacing=12) => Number(base) + (Number(idx) * Number(spacing)));
  // add: simple addition for displaying option numbers
  if (!Handlebars.helpers.add)
    Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
  if (!Handlebars.helpers.truncate)
    Handlebars.registerHelper('truncate', (str, len=20) => {
      if (!str) return "";
      const s = String(str);
      return s.length > len ? s.slice(0, len) + "…" : s;
    });
});

// =====================
// Expose constructors
// =====================
window.DialoguePromptWindow = DialoguePromptWindow;
window.DialogueEditor = DialogueEditor;
window.DialogueRequirements = DialogueRequirements;
window.DialogueResults = DialogueResults;
window.DialogueTreeEditor = DialogueTreeEditor;