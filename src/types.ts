export type Usage = {
  input_tokens: number;
  output_tokens: number;
};

export type ExecutionPhase =
  | "thinking"
  | "reading_file"
  | "writing_file"
  | "running_command"
  | "streaming"
  | "searching_web"
  | "finished"
  | "error";

export type ExecutionEvent = {
  phase: ExecutionPhase;
  message: string;
  file_path?: string;
  command?: string;
  status?: "start" | "progress" | "end";
  exit_code?: number | null;
  success?: boolean;
  metadata?: Record<string, unknown>;
  timestamp: number;
};

export type SearchCitation = {
  index: number;
  title: string;
  url: string;
  snippet: string;
  source?: string;
  date?: string;
};

export type StreamHealthState = {
  attempts: number;
  timeout_ms: number;
  fallback_used: boolean;
  throttled_renders: number;
  last_error?: string;
};

export type SessionAccessGrantMode = "unknown" | "full" | "selective";

export type SessionAccessGrant = {
  mode: SessionAccessGrantMode;
  asked_at?: number;
  allowlist: string[];
  denylist: string[];
};

export type CommandExecutionRecord = {
  command: string;
  cwd: string;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  timeout_ms: number;
  exit_code: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
};

export type TaskChange = {
  file: string;
  original: string;
  edited: string;
  start_line?: number;
  end_line?: number;
};

export type TaskCommand = {
  command: string;
  reason?: string;
};

export type SessionEntry = {
  role: string;
  content: string;
  changes?: number;
  time?: number;
};

export type SessionFile = {
  name: string;
  session: SessionEntry[];
  metadata?: Record<string, unknown>;
};

export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ProviderConfig = {
  endpoint?: string;
  model?: string;
  generation?: Record<string, unknown>;
  stream?: boolean;
  stream_print?: boolean;
  [key: string]: unknown;
};

export type ConfigShape = {
  active_provider?: string;
  providers?: Record<string, ProviderConfig>;
  planning_mode?: boolean;
  fast_mode?: boolean;
  mission_mode?: boolean;
  voice_mode?: boolean;
  newline_support?: boolean;
  visibility_allowed?: boolean;
  auto_reload_session?: boolean;
  web_browsing_allowed?: boolean;
  see_project_mode?: boolean;
  mcp_servers?: Record<string, McpServerSpec>;
  mcp_enabled?: boolean;
  theme?: Record<string, string>;
  effort_level?: string;
  reasoning_level?: string;
  stream?: boolean;
  stream_print?: boolean;
  env_bridge_enabled?: boolean;
  stream_timeout_ms?: number;
  stream_retry_count?: number;
  stream_render_fps?: number;
  command_timeout_ms?: number;
  command_log_enabled?: boolean;
  strict_edit_requires_full_access?: boolean;
  max_budget?: number;
  auto_compact_enabled?: boolean;
  auto_compact_threshold_pct?: number;
  auto_compact_keep_recent_turns?: number;
  run_policy?: "ask" | "always" | "never";
  theme_mode?: "dark" | "white" | "follow_windows";
  onboarding_completed?: boolean;
  access_scope?: "limited" | "full_desktop";
  [key: string]: unknown;
};

export type TaskPayload = {
  mode: "plan" | "apply";
  fast: boolean;
  instruction: string;
  build_intent: boolean;
  referenced_paths: string[];
  execution_contract: Record<string, unknown>;
  user_os: string;
  raw_input: string;
  effort_level: string;
  reasoning_level: string;
  context_files: Array<Record<string, unknown>>;
  session_history: Array<{ role: string; content: string }>;
  mission_data?: MissionData | null;
  project_map?: string | null;
  project_listing?: string | null;
  image_files: Array<Record<string, unknown>>;
  image_descriptions: Array<Record<string, unknown>>;
  image_errors: string[];
  _stream_enabled?: boolean;
  _stream_print?: boolean;
  _ollama_context?: number[];
  ollama_context_mode?: "cold" | "warm";
  ollama_include_system?: boolean;
  ollama_include_history?: boolean;
  [key: string]: unknown;
};

export type MissionData = Record<string, unknown>;

export type SessionStats = {
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
  turns: number;
  model: string;
  start_time: number;
  provider?: string;
  context_used?: number;
  context_window?: number | null;
  context_left?: number | null;
};
