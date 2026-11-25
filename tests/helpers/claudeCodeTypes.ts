/** Shapes of the plain-JS claude-code modules, for typing the tests. */

export type Frame = {
  type?: string;
  event: string;
  payload: {
    state?: string;
    stream?: string;
    runId?: string;
    errorMessage?: string;
    message?: { content?: string };
    data?: { phase?: string; arguments?: Record<string, unknown> };
    [key: string]: unknown;
  };
};

export type Avatar = {
  id: string;
  name: string;
  role: string;
  sessionId: string;
  workspace: string;
  managed?: boolean;
  started?: boolean;
  runId: string | null;
  files: Record<string, string>;
  history: { role: string; content: string }[];
};

export type State = { agents: Map<string, Avatar>; seq: number };

export type Workspace = { id: string; label: string; path: string };

type SendResult = { ok: boolean; code?: string; message?: string };

export type Runner = {
  createAgent(options: { name: string; role?: string; workspaceId?: string }): Avatar;
  removeAgent(agentId: string): boolean;
  renameAgent(agentId: string, name: string): boolean;
  setFile(agentId: string, fileName: string, content: string): boolean;
  getFile(agentId: string, fileName: string): string | undefined;
  restore(profiles: unknown[]): number;
  send(options: { agentId: string; message: string; runId: string }): SendResult;
  abort(options: { agentId?: string; runId?: string }): number;
  stopAll(): void;
  isRunning(agentId: string): boolean;
};
