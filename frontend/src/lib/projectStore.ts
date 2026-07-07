import { storage } from "@/src/utils/storage";

export type ProjectFile = {
  path: string;
  content: string;
  size: number;
  language?: string;
};

export type Project = {
  id: string;
  name: string;
  files: ProjectFile[];
  tech_stack: string[];
  created_at: string;
  updated_at: string;
};

const KEY = "zipforge.projects.v1";
const ACTIVE_KEY = "zipforge.activeProjectId";
const ACTIVE_FILE_KEY = "zipforge.activeFilePath";

export async function listProjects(): Promise<Project[]> {
  const raw = await storage.getItem<string>(KEY, "");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await storage.setItem(KEY, JSON.stringify(projects));
}

export async function addProject(project: Project): Promise<void> {
  const existing = await listProjects();
  existing.unshift(project);
  await saveProjects(existing);
}

export async function updateProject(project: Project): Promise<void> {
  const existing = await listProjects();
  const idx = existing.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    existing[idx] = { ...project, updated_at: new Date().toISOString() };
    await saveProjects(existing);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const existing = await listProjects();
  await saveProjects(existing.filter((p) => p.id !== id));
  const active = await getActiveProjectId();
  if (active === id) await setActiveProjectId(null);
}

export async function getProject(id: string): Promise<Project | null> {
  const existing = await listProjects();
  return existing.find((p) => p.id === id) || null;
}

export async function getActiveProjectId(): Promise<string | null> {
  return storage.getItem<string>(ACTIVE_KEY, "").then((v) => v || null);
}

export async function setActiveProjectId(id: string | null): Promise<void> {
  if (id) await storage.setItem(ACTIVE_KEY, id);
  else await storage.removeItem(ACTIVE_KEY);
}

export async function getActiveFilePath(): Promise<string | null> {
  return storage.getItem<string>(ACTIVE_FILE_KEY, "").then((v) => v || null);
}

export async function setActiveFilePath(path: string | null): Promise<void> {
  if (path) await storage.setItem(ACTIVE_FILE_KEY, path);
  else await storage.removeItem(ACTIVE_FILE_KEY);
}

// ---- helpers ----
export function detectLanguage(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".scss") || p.endsWith(".sass")) return "scss";
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs"))
    return "javascript";
  if (p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".tsx")) return "tsx";
  if (p.endsWith(".jsx")) return "jsx";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".java")) return "java";
  if (p.endsWith(".kt") || p.endsWith(".kts")) return "kotlin";
  if (p.endsWith(".c")) return "c";
  if (p.endsWith(".cpp") || p.endsWith(".cc") || p.endsWith(".cxx"))
    return "cpp";
  if (p.endsWith(".h") || p.endsWith(".hpp")) return "cpp";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".rb")) return "ruby";
  if (p.endsWith(".php")) return "php";
  if (p.endsWith(".swift")) return "swift";
  if (p.endsWith(".sh") || p.endsWith(".bash")) return "bash";
  if (p.endsWith(".xml")) return "xml";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".sql")) return "sql";
  if (p.endsWith(".txt") || p.endsWith(".log")) return "text";
  return "text";
}

export function detectTechStack(files: ProjectFile[]): string[] {
  const stack = new Set<string>();
  for (const f of files) {
    const l = f.language;
    if (!l) continue;
    if (l === "html" || l === "css" || l === "javascript") stack.add("Web");
    if (l === "typescript" || l === "tsx" || l === "jsx") stack.add("React");
    if (l === "python") stack.add("Python");
    if (l === "java") stack.add("Java");
    if (l === "kotlin") stack.add("Kotlin");
    if (l === "cpp" || l === "c") stack.add("C/C++");
    if (l === "rust") stack.add("Rust");
    if (l === "go") stack.add("Go");
    if (l === "swift") stack.add("Swift");
    if (f.path.toLowerCase().includes("package.json")) stack.add("Node.js");
    if (f.path.toLowerCase().includes("build.gradle")) stack.add("Gradle");
    if (f.path.toLowerCase().includes("android")) stack.add("Android");
  }
  return Array.from(stack);
}

export function isBinaryFilename(path: string): boolean {
  const p = path.toLowerCase();
  const binExts = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".bmp",
    ".zip",
    ".jar",
    ".class",
    ".dex",
    ".apk",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".mp3",
    ".mp4",
    ".mov",
    ".wav",
    ".pdf",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
  ];
  return binExts.some((e) => p.endsWith(e));
}
