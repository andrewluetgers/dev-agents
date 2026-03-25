// Agent container info
export interface AgentInfo {
  id: string;
  containerId: string;
  hostPort: number;
  channelPort: number;
  homeDir: string;
  project: string | null;
  status: string;
  lastSeen: string;
  task?: string;
}

// Events pushed from agents to orchestrator
export interface AgentEvent {
  type: "status" | "result" | "error" | "prompt" | "request" | "permission_request";
  agent: string;
  content: string;
  port?: number;
  channelPort?: number;
  permission?: {
    request_id: string;
    tool_name: string;
    description: string;
    input_preview: string;
  };
}

// Claude session state (from agent /health)
export interface SessionState {
  status: "idle" | "starting" | "running" | "thinking" | "tool_use" | "done" | "error";
  currentTool: string | null;
  lastActivity: string;
  turns: number;
}

// Project config in orchestrator config.json
export interface ProjectConfig {
  localPath: string;
  note?: string;
}

// Orchestrator config.json
export interface OrchestratorConfig {
  agentImage: string;
  homesDir: string;
  channelPort: number;
  defaults: {
    memory: string;
    agentUid: number;
  };
  projects: Record<string, ProjectConfig>;
}

// Loop — recurring polling command
export interface Loop {
  id: string;
  agentId: string;
  command: string;
  type: "exec" | "message";
  intervalMs: number;
  label: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  lastExitCode?: number;
  createdAt: string;
}

// Kanban task card
export type TaskLane = "backlog" | "planning" | "in_progress" | "review" | "done";

export interface TaskCard {
  id: string;
  title: string;
  description: string;
  lane: TaskLane;
  project: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
}
