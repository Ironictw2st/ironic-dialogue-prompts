Hooks.once('init', function() {

     game.settings.register('ironic-dialogue-prompts', 'enable-prompts', {
        name: 'Enable Prompts',
        hint: '',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // Show Advanced JSON editors (client-side so each GM can choose)
    game.settings.register('ironic-dialogue-prompts', 'advanced-json', {
    name: 'Show Advanced (JSON) Options',
    hint: 'When enabled, the Dialogue Editor shows raw JSON textareas for Requirements and Results. When disabled, only the dropdown builder (Requirements) is shown.',
    scope: 'client',     // per-user toggle
    config: true,
    type: Boolean,
    default: false
    });

    // Dialogue presets storage (hidden from UI)
    game.settings.register('ironic-dialogue-prompts', 'dialogue-presets', {
        name: 'Dialogue Presets',
        hint: 'Stored dialogue presets for quick loading',
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

});