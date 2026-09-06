<div style="text-align: center; margin: 20px 0;">
  <img src="images/settings-ai.png" alt="Settings → AI tab" style="width: 600px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Settings → AI</div>
</div>

The AI tab controls provider setup, model selection, prompt framing, cost awareness, and the defaults used by Inquiry, Pulse, Gossamer, and Summary Refresh.

## AI Toggle

*   **Enable AI LLM features**: Turns AI-driven commands and scene-analysis UI on or off. Disabling AI hides those surfaces but does not delete existing note properties.

> **Default: off.** New installs make no AI connection and transfer no data until you enable this toggle and configure either a cloud provider API key or a local AI server. Existing vaults keep the setting you already chose — upgrading never flips it for you.

## AI Strategy

This is the main routing section for cloud and local AI.

*   **Provider**: Choose **Anthropic**, **OpenAI**, **Google**, or **Local LLM**.
*   **Model**: Choose **Auto** for the latest stable model, or select a specific model to pin it.
*   **Access**: Set the tier that your provider account has granted you. These tiers are applied for and approved by the provider, then reflected here for context limits and capability headroom.
*   **Cost Estimate**: Shows estimated Inquiry pricing for your current manuscript scope.
*   **What gets sent to the AI**: Breakdown cards for Inquiry and Gossamer so you can see the rough corpus, prompt, output, and processing footprint.

## Role Context

*   **AI prompt role & context template**: Controls the shared editorial framing used across AI features.
*   **Manage context templates**: Use the gear button to edit templates and switch the active one.

## API Keys

Store each cloud provider’s key in **Obsidian secret storage** on this device. The secret name identifies the saved key; enter the API key itself in the provider’s key field.

*   Radial Timeline validates saved keys with the provider and shows their status.
*   **Replace key…** updates the saved key; **Copy key name** copies its secret-storage name.
*   Secure key saving requires an Obsidian build with secret storage. Keys are never saved in plain-text plugin settings.

## Configuration

Set defaults for analysis and scene hover display.

### Inquiry

*   **Enable citations (temporarily unavailable)**: Strict provider-level inline citations are still paused.
*   Findings include evidence quotes and scene references in the result’s **Sources** block.

### Timeline Display

*   **Pulse context**: Include previous and next scene analysis in the scene hover reveal.
*   **Synopsis max words**: Base target for stored Synopsis generation.

### Summary Refresh Defaults

*   **Target summary length**: Default word target when opening Summary Refresh.
*   **Treat summary as weak if under**: Default threshold for selecting scenes as weak/stale in the Inquiry View Corpus model.
*   **Also update Synopsis**: When enabled, Summary Refresh also rewrites `Synopsis` using the configured cap.

> [!NOTE]
> AI diagnostics logging lives on the Advanced tab as **Enable AI content logs** — see [Settings → Advanced](Settings-Advanced).

---

## Local LLM

Choose **Provider → Local LLM** to use Ollama, LM Studio, or another OpenAI-compatible server. Select a model and run **Validate Local LLM** to check its readiness for the features you use.

A server on the same machine keeps manuscript text on-device and uses your own hardware. If you configure a network server, manuscript text is sent to that endpoint.

### Local LLM Configuration

*   **Local server**: Select the runtime behind the Local LLM path — **Ollama**, **LM Studio**, or a generic **OpenAI-Compatible** server.
*   **Base URL**: Endpoint for the selected server. Defaults differ per runtime — see the setup blocks below.
*   **Manual model ID (fallback)**: Enter a model ID when automatic discovery misses it.
*   **Structured JSON mode**: Choose server-enforced **Response format** or **Prompt only**. Radial Timeline validates replies in both modes.
*   **Model capabilities**: Declare **Extended reasoning**, **Long context**, and **High output ceiling** to match your model; these settings determine feature eligibility.

### Local LLM Status And Validation

This section is the health check for local AI.

*   **Load Servers**: Detect available local runtimes.
*   **Load Models**: Query the selected runtime for installed models.
*   **Validate Local LLM**: Run connection and capability checks.
*   The status area reports connection, model availability, validation state, and rough capability strength.

### Setting Up Ollama

1. Install and run [Ollama](https://ollama.com) on the same machine as Obsidian (or a machine reachable from it).
2. Pull a model with Ollama's own tooling, then select **Ollama** as the local server.
3. **Base URL** defaults to `http://localhost:11434/v1`. Leave it as-is for a local install; change the host if Ollama runs elsewhere on your network.
4. Use **Load Models** to confirm Radial Timeline can see your pulled models, then **Validate Local LLM**.

### Setting Up LM Studio

1. Install [LM Studio](https://lmstudio.ai) and download a model inside it.
2. Start LM Studio's local server (its own UI has a server toggle), then select **LM Studio** as the local server in Radial Timeline.
3. **Base URL** defaults to `http://localhost:1234/v1`.
4. Use **Load Models** to confirm the loaded model is visible, then **Validate Local LLM**.

### Local LLM Troubleshooting

**Validate Local LLM** runs a sequence of checks — each can fail independently, and the message tells you which one to fix first.

| Check | What it means | How to fix |
| :--- | :--- | :--- |
| Server unreachable | Radial Timeline could not reach the **Base URL** at all. | Confirm the runtime is running, the port matches (Ollama `11434`, LM Studio `1234`), and no firewall/VPN is blocking localhost traffic. |
| Model not loaded | The server responded, but the model you selected isn't among the models it reports. | In Ollama, pull the model; in LM Studio, load it in the app. Then re-run **Load Models**. |
| No structured-output support | The server returned text, but Radial Timeline could not get clean structured JSON out of it — required for Pulse, Gossamer, and Inquiry to parse results. | Try a different, more capable model. Some small or heavily quantized models cannot reliably follow structured-output instructions. |
| Context too small | The model's context window or output limit is too small for the prompt Radial Timeline needs to send (this shows up as a low capability tier, or as a timeout on basic/structured completion checks). | Choose a model with a larger context window, or reserve Local LLM for lighter tasks (Summary, single-scene work) and use a hosted provider for larger corpus features. |

### Pulse Model Requirements

Pulse sends three scenes together and requires structured JSON results. Choose a model that can handle the full prompt and return complete results, then check its capability and feature-support readout with **Validate Local LLM**.

### Onboarding And Local Model Hardware

[Onboard manuscript](Commands#onboard-manuscript) is a beta workflow in development/testing builds. It supports structure-only import and optional Local LLM assistance; onboarding AI requests use the configured local endpoint.

The verified hardware setup is a **Mac Studio M4 Max with 64GB unified memory** running **Qwen3-Next-80B-A3B-Instruct (4-bit)**. Earlier testing also used **Qwen3-30B-A3B-2507 (4-bit)**, with weaker results. Treat these as tested setups and validate your chosen model before importing a manuscript.

### Choosing a Provider

*   **Local LLM** uses your own server and hardware. Validate the model for each workflow.
*   **Anthropic**, **OpenAI**, and **Google** use your provider account and API billing. Review the cost estimate before a run.
