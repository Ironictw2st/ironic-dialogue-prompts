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

  // --- Player-facing Dialogue Mode (unchanged style) ---
  const dialogueButton = html.querySelector('[data-tool="ironic-dialogue"]');
  if (dialogueButton && !dialogueButton.dataset.bound) {
    dialogueButton.dataset.bound = "true";
    dialogueButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      ui.notifications.info("Click on an NPC token to start dialogue.");

      const handler = (token, controlled) => {
        if (!controlled) return;

        const actor = token.actor;
        if (!actor || actor.type !== "npc") {
          ui.notifications.warn("Please select an NPC token.");
          return;
        }

        Hooks.off('controlToken', handler);
        token.release();

        // players use their assigned character; GMs will be prompted if needed
        openDialogue(actor);
      };

      Hooks.on('controlToken', handler);
    });
  }

  // --- GM-only: Dialogue Editor button (edit mode) ---
  if (!game.user.isGM) return;
  const dialogueEditButton = html.querySelector('[data-tool="ironic-dialogue-edit"]');
  if (dialogueEditButton && !dialogueEditButton.dataset.bound) {
    dialogueEditButton.dataset.bound = "true";
    dialogueEditButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // If an NPC token is already selected, open immediately
      const preSel = canvas.tokens?.controlled?.[0];
      if (preSel?.actor?.type === "npc") {
        new DialogueEditor(preSel.actor, { mode: "edit" }).render(true);
        return;
      }

      ui.notifications.info("GM: click an NPC token to open the Dialogue Editor.");

      const handler = (token, controlled) => {
        if (!controlled) return;

        const actor = token.actor;
        if (!actor || actor.type !== "npc") {
          ui.notifications.warn("Please select an NPC token.");
          return;
        }

        Hooks.off('controlToken', handler);
        token.release();

        try {
          new DialogueEditor(actor, { mode: "edit" }).render(true);
        } catch (err) {
          console.error(err);
          ui.notifications.error("Failed to open Dialogue Editor. See console for details.");
        }
      };

      Hooks.on('controlToken', handler);
    });
  }
});



// Main function to open dialogue with an NPC
// Open dialogue with an NPC, optionally forcing a specific player Actor
async function openDialogue(npc, overridePlayerActor = undefined) {
  // Get dialogue data from NPC
  const dialogueData = npc.getFlag('ironic-dialogue-prompts', 'dialogue');

  // Check if NPC has dialogue configured
  if (!dialogueData || !dialogueData.dialogueNodes || !dialogueData.dialogueNodes.start) {
    ui.notifications.warn(`${npc.name} has no dialogue configured.`);

    // If GM, offer to open the editor
    if (game.user.isGM) {
      new DialogueEditor(npc).render(true);
    }
    return;
  }

  // Determine player actor
  let playerActor = overridePlayerActor ?? game.user.character;

  // If no playerActor and user is GM, let them pick any PC on the map (or Preview)
  if (!playerActor && game.user.isGM) {
    playerActor = await promptGMForPCActor(game.user.character ?? null);
    if (playerActor === undefined) return; // cancelled
    // if null => preview mode (no PC)
  }

  // If still no playerActor and not GM, block
  if (!playerActor && !game.user.isGM) {
    ui.notifications.warn("You need an assigned character to start dialogue.");
    return;
  }

  // Open the dialogue window (fall back to preview if no PC chosen)
  new DialoguePromptWindow(npc, dialogueData, playerActor ?? npc).render(true);
}


/** Return [{ id, label, tokenId, actor }] for PC-capable tokens on the current scene */
function getPCChoicesOnCanvas() {
  const pcs = [];
  for (const t of canvas.tokens.placeables) {
    const a = t.actor;
    if (!a) continue;
    // Consider "character" type or anything with a player owner as a PC
    const isPC = a.type === "character" || a.hasPlayerOwner;
    if (!isPC) continue;
    pcs.push({
      id: a.id,
      label: `${a.name} ${t.name && t.name !== a.name ? `(${t.name})` : ""}`.trim(),
      tokenId: t.id,
      actor: a
    });
  }
  // De-dupe by actor id but prefer the first token label for readability
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

  if (result === undefined) return undefined;           // cancelled
  if (result === noneValue) return null;                // preview
  const picked = choices.find(c => c.id === result);
  return picked?.actor ?? null;                         // actor or null
}

Hooks.once('init', () => {
  if (!Handlebars.helpers.eq)    Handlebars.registerHelper('eq', (a,b) => a===b);
  if (!Handlebars.helpers.json)  Handlebars.registerHelper('json', (obj) => JSON.stringify(obj ?? "", null, 2));
  if (!Handlebars.helpers.array) Handlebars.registerHelper('array', (...args) => args.slice(0,-1));
  if (!Handlebars.helpers.calcMid)
    Handlebars.registerHelper('calcMid', (a,b,off=0)=>((Number(a)+Number(b))/2 + Number(off)));

});



// Make classes globally available
window.DialoguePromptWindow = DialoguePromptWindow;
window.DialogueEditor = DialogueEditor;
window.DialogueRequirements = DialogueRequirements;
window.DialogueResults = DialogueResults;