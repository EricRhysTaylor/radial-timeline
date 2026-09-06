Pulse analyzes each scene with its previous and next scenes, then saves grades and editorial feedback in scene properties for hover review.

*   **Manuscript or subplot order**: Evaluate the reading sequence or follow one subplot.
*   **Scene feedback**: Review strengths, continuity, and opportunities to improve scene flow.
*   **Compact hover**: Turn off **Pulse context** in Settings → AI to show the current scene’s feedback alone.

**Modes**: Progress mode (key `1`), Narrative mode (key `2`), Chronologue mode (key `3`)
**Command**: `Scene pulse analysis (manuscript order)`, `Scene pulse analysis (subplot order)`
**Settings**: [Settings → AI](Settings-AI) — enable **Enable AI LLM features** and choose a provider

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-scene-pulse.png" alt="AI Pulse Triplet Analysis" style="width: 600px; max-width: 100%;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">AI Pulse Triplet Analysis</div>
</div>

<div style="text-align: center; margin: 20px 0;">
  <img src="images/feature-pulse.png" alt="Pulse triplet output in scene hover metadata" style="width: 720px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Pulse triplet output — previous, current, and next scene grades surfaced in hover</div>
</div>

## Supported Providers

Pulse works with all supported AI providers:

*   **Anthropic Claude**
*   **OpenAI GPT**
*   **Google Gemini**
*   **Local LLM** (Ollama, LM Studio, and OpenAI-compatible servers)

Local LLM setup is documented under [Settings → AI → Local LLM](Settings-AI#local-llm). Local runs are validated before analysis starts and results are written with the same safeguards as hosted providers.

For the command-specific batch workflows, see:

*   [Scene pulse analysis (manuscript order)](Commands#scene-pulse-analysis-manuscript-order)
*   [Scene pulse analysis (subplot order)](Commands#scene-pulse-analysis-subplot-order)
*   [Summary refresh](Commands#summary-refresh)
