# Troubleshooting

## Provider/API Issues
### Symptom
`Provider initialization failed` or `API key not found`.

### Checks
1. Run `/provider` to confirm active provider.
2. Run `/config` and verify key is set.
3. For `.env` usage, ensure `env_bridge_enabled=true`.
4. Validate with `/status`.

## Local Ollama Unreachable
### Symptom
`Could not connect to Ollama`.

### Checks
1. Start Ollama app/service.
2. Verify endpoint:
```bash
/config ollama_endpoint http://localhost:11434
```
3. Ensure model exists:
```bash
ollama pull qwen3:14b // THIS IS AN EXAMPLE MODEL USE SOMETHING ELSE IF YOU NEED TO
```

## Streaming Freezes or Fallback
### Symptom
Stream stalls or falls back to non-stream mode.

### Checks
1. Increase timeout:
```bash
/config stream_timeout_ms 120000
```
2. Increase retries:
```bash
/config stream_retry_count 2
```
3. Reduce render pressure:
```bash
/config stream_render_fps 18
```

## File Access Denied
### Symptom
Agent cannot read/write required files.

### Checks
1. Review session access:
```bash
/access status
```
2. Re-prompt policy:
```bash
/access reset
/access prompt
```
3. In selective mode, allow path:
```bash
/access allow src/core/agent.ts
```

## Command Execution Timeouts
### Symptom
Commands terminate with timeout.

### Checks
1. Increase timeout:
```bash
/config command_timeout_ms 60000
```
2. Inspect logs:
```bash
/logs 30
```

## CI Failing on Lint/Test/Build
### Run locally
```bash
npm run lint
npm run test
npm run build
```

### Common causes
- Missing ESLint config.
- Type errors from new interfaces.
- Runtime asset generation drift (run `npm run gen:runtime-assets`).

