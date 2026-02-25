export type Usage = {
  input_tokens: number;
  output_tokens: number;
};

export type TaskChange = {
  file: string;
  original: string;
  edited: string;
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
