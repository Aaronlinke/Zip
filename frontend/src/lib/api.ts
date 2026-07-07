const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export const API_BASE = `${BASE}/api`;

export type ChatMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
};

export type Snippet = {
  id: string;
  name: string;
  language: string;
  tags: string[];
  description: string;
  content: string;
};

export async function sendChatMessage(params: {
  session_id: string;
  message: string;
  code_context?: string;
  file_name?: string;
  model?: string;
  provider?: string;
}): Promise<ChatMessage> {
  const res = await fetch(`${API_BASE}/ai/chat/simple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Chat failed: ${res.status} ${t}`);
  }
  return res.json();
}

export async function fetchSessionMessages(
  session_id: string
): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/ai/sessions/${session_id}/messages`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE}/ai/sessions`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export async function deleteSession(session_id: string): Promise<void> {
  await fetch(`${API_BASE}/ai/sessions/${session_id}`, { method: "DELETE" });
}

export async function fetchSnippets(): Promise<Snippet[]> {
  const res = await fetch(`${API_BASE}/snippets`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

// ---------- Forge Pipeline (async job pattern) ----------
export type TargetEnv =
  | "powershell"
  | "termux"
  | "python"
  | "sqlite"
  | "lua"
  | "html_js";

export type PipelineFile = {
  stage: "architect" | "refiner" | "synthesizer";
  name: string;
  content: string;
  language: string;
};

export type PipelineJob = {
  id: string;
  status: "pending" | "running" | "done" | "error";
  stage: "architect" | "refiner" | "synthesizer" | null;
  prompt: string;
  target_env: TargetEnv;
  files: PipelineFile[];
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function startForgePipeline(params: {
  prompt: string;
  target_env: TargetEnv;
}): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/forge/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Pipeline start failed: ${res.status} ${t}`);
  }
  return res.json();
}

export async function getForgeJob(jobId: string): Promise<PipelineJob> {
  const res = await fetch(`${API_BASE}/forge/pipeline/${jobId}`);
  if (!res.ok) throw new Error(`Job fetch failed: ${res.status}`);
  return res.json();
}

// ---------- Termux Export ----------
export async function exportTermuxInstaller(params: {
  project_name: string;
  files: {
    path: string;
    content: string;
    size: number;
    language?: string;
  }[];
  target_env?: string;
}): Promise<{ filename: string; content: string; size: number; file_count: number }> {
  const res = await fetch(`${API_BASE}/export/termux`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.json();
}

export async function exportApkBuilder(params: {
  project_name: string;
  package_id?: string;
  files: {
    path: string;
    content: string;
    size: number;
    language?: string;
  }[];
}): Promise<{
  filename: string;
  content: string;
  size: number;
  file_count: number;
  package_id: string;
  main_html: string;
}> {
  const res = await fetch(`${API_BASE}/export/apk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`APK export failed: ${res.status}`);
  return res.json();
}
