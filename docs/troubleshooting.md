# Troubleshooting Guide

This guide covers common issues, symptoms, and their resolutions when using Agent CLI.

---

## 🔑 Provider & API Issues

### **Symptom**
The agent outputs: `Provider initialization failed` or `API key not found`.

### **Diagnostic Checks**
1. **Verify the active provider:**
   Run `/provider` to confirm which provider is currently active.
2. **Check API key configuration:**
   Run `/config` and verify that the corresponding provider key is properly set.
3. **Environment bootstrap checks:**
   If you rely on a `.env` file, ensure that `env_bridge_enabled=true` is set in your configuration.
4. **Overall validation:**
   Validate provider connectivity by running `/status`.
5. **Hugging Face Model Gating:**
   Ensure your API Token has permissions for the model you've selected (some gated models like Llama require explicit approval on the Hugging Face website).

---

## 🖥 Local Ollama Unreachable

### **Symptom**
The agent outputs: `Could not connect to Ollama`.

### **Diagnostic Checks**
1. **Ensure Ollama is running:**
   Start the local Ollama application or background service.
2. **Verify the endpoint configuration:**
   Confirm Agent CLI refers to the correct local port:
   ```bash
   /config endpoint http://localhost:11434
   ```
3. **Ensure the model is pulled locally:**
   ```bash
   ollama pull qwen3:14b  # Substitute with your chosen model
   ```

---

## 🐢 Streaming Freezes or UI Stalls

### **Symptom**
The text output stream stalls indefinitely, freezes the TUI, or forcefully falls back to a non-streamed batched mode.

### **Diagnostic Checks**
1. **Increase the streaming timeout:**
   Grant the CLI more time to wait for the LLM response chunk:
   ```bash
   /config stream_timeout_ms 120000
   ```
2. **Increase retry limits:**
   ```bash
   /config stream_retry_count 2
   ```
3. **Reduce rendering pressure:**
   If the GUI struggles to redraw rapid chunks, lower the target frames per second:
   ```bash
   /config stream_render_fps 18
   ```

---

## 🔒 File Access Denied

### **Symptom**
The agent indicates it cannot read or write to required workspace files during its operation.

### **Diagnostic Checks**
1. **Review current session access:**
   ```bash
   /access status
   ```
2. **Re-prompt the user access policy:**
   Reset and request full permissions again:
   ```bash
   /access reset
   /access prompt
   ```
3. **Allow specific paths (`selective` mode):**
   If you are running in selective mode, explicitly whitelist the file:
   ```bash
   /access allow src/core/agent.ts
   ```

---

## ⏱️ Command Execution Timeouts

### **Symptom**
Terminal commands executed by the agent forcefully terminate with a timeout error.

### **Diagnostic Checks**
1. **Increase the global execution timeout:**
   ```bash
   /config command_timeout_ms 60000
   ```
2. **Inspect the underlying execution logs:**
   Review exactly what the process printed to `stdout/stderr` right before the timeout:
   ```bash
   /logs 30
   ```

---

## 🔧 Continuous Integration (CI) Failures

If you are developing for Agent CLI, you might encounter failures on Lint, Test, or Build.

### **Run locally to verify**
Always run the validation suite locally before pushing:
```bash
npm run lint
npm run test
npm run build
```

### **Common Causes**
- **ESLint Errors:** Missing or misconfigured ESLint rules.
- **TypeScript Errors:** Type mismatches from newly introduced interfaces.
- **Asset Drift:** Runtime asset generation has drifted from the source. Fix this by pulling the latest changes and running:
  ```bash
  npm run gen:runtime-assets
  ```
