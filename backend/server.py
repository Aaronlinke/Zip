from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# LLM Key
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

app = FastAPI(title="ZipForge API")
api_router = APIRouter(prefix="/api")


# ============== MODELS ==============
class ChatMessageIn(BaseModel):
    session_id: str = Field(..., description="Unique conversation session id")
    message: str
    code_context: Optional[str] = None
    file_name: Optional[str] = None
    model: str = "claude-sonnet-4-5-20250929"
    provider: str = "anthropic"


class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: str  # 'user' | 'assistant'
    content: str
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ChatSession(BaseModel):
    id: str
    title: str
    created_at: str
    last_message_at: str
    message_count: int


class ProjectFile(BaseModel):
    path: str
    content: str
    size: int
    language: Optional[str] = None


class ProjectIn(BaseModel):
    name: str
    files: List[ProjectFile]
    tech_stack: List[str] = []


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    files: List[ProjectFile]
    tech_stack: List[str] = []
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ============== ROUTES ==============
@api_router.get("/")
async def root():
    return {"service": "ZipForge API", "status": "online"}


# ---------- AI CHAT (Claude Sonnet 4.5 via Emergentintegrations) ----------
SYSTEM_PROMPT = """You are ZipForge AI, a world-class senior software engineer built into a mobile Dev Studio.

Your job:
- Help the user READ, UNDERSTAND, IMPROVE and CONVERT code.
- When code is given, analyze it thoroughly and suggest concrete improvements.
- ALWAYS format code with proper markdown code fences (```lang ... ```).
- Be concise but complete. Prefer step-by-step reasoning over long prose.
- If asked to convert code, produce a full, working translation in the target language.
- If asked to "make it better", focus on correctness, performance, readability, and modern best practices.

The user is working on mobile, so keep your responses focused and actionable."""


@api_router.post("/ai/chat")
async def ai_chat(payload: ChatMessageIn):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")

    # Persist the user message first
    user_msg = ChatMessage(
        session_id=payload.session_id,
        role="user",
        content=payload.message,
    )
    await db.chat_messages.insert_one(user_msg.model_dump())

    # Build the full prompt with optional code context
    prompt_text = payload.message
    if payload.code_context:
        header = f"File: {payload.file_name}" if payload.file_name else "Code context:"
        prompt_text = (
            f"{header}\n\n```\n{payload.code_context}\n```\n\n"
            f"User question: {payload.message}"
        )

    # Fetch history and build LlmChat with prior messages
    # Note: LlmChat maintains its own session state internally via session_id;
    # our DB is the source of truth for UI history.

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=payload.session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model(payload.provider, payload.model)

    async def event_gen():
        full_response = ""
        try:
            async for event in chat.stream_message(UserMessage(text=prompt_text)):
                if isinstance(event, TextDelta):
                    full_response += event.content
                    yield f"data: {event.content}\n\n"
                elif isinstance(event, StreamDone):
                    break
        except Exception as e:  # noqa: BLE001
            logger.exception("LLM stream error")
            yield f"event: error\ndata: {str(e)}\n\n"
            return

        # Persist assistant reply
        assistant_msg = ChatMessage(
            session_id=payload.session_id,
            role="assistant",
            content=full_response,
        )
        await db.chat_messages.insert_one(assistant_msg.model_dump())
        yield "event: done\ndata: [DONE]\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@api_router.post("/ai/chat/simple", response_model=ChatMessage)
async def ai_chat_simple(payload: ChatMessageIn):
    """Non-streaming chat — easier for mobile clients that struggle with SSE."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")

    # Persist user message
    user_msg = ChatMessage(
        session_id=payload.session_id,
        role="user",
        content=payload.message,
    )
    await db.chat_messages.insert_one(user_msg.model_dump())

    prompt_text = payload.message
    if payload.code_context:
        header = f"File: {payload.file_name}" if payload.file_name else "Code context:"
        prompt_text = (
            f"{header}\n\n```\n{payload.code_context}\n```\n\n"
            f"User question: {payload.message}"
        )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=payload.session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model(payload.provider, payload.model)

    try:
        response_text = await chat.send_message(UserMessage(text=prompt_text))
    except Exception as e:  # noqa: BLE001
        logger.exception("LLM error")
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    assistant_msg = ChatMessage(
        session_id=payload.session_id,
        role="assistant",
        content=str(response_text),
    )
    await db.chat_messages.insert_one(assistant_msg.model_dump())
    return assistant_msg


@api_router.get("/ai/sessions/{session_id}/messages", response_model=List[ChatMessage])
async def get_session_messages(session_id: str):
    docs = (
        await db.chat_messages.find({"session_id": session_id}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(500)
    )
    return [ChatMessage(**d) for d in docs]


@api_router.get("/ai/sessions", response_model=List[ChatSession])
async def list_sessions():
    pipeline = [
        {
            "$group": {
                "_id": "$session_id",
                "first_message": {"$first": "$content"},
                "created_at": {"$min": "$created_at"},
                "last_message_at": {"$max": "$created_at"},
                "message_count": {"$sum": 1},
            }
        },
        {"$sort": {"last_message_at": -1}},
        {"$limit": 100},
    ]
    docs = await db.chat_messages.aggregate(pipeline).to_list(100)
    return [
        ChatSession(
            id=d["_id"],
            title=(d.get("first_message") or "Untitled")[:60],
            created_at=d["created_at"],
            last_message_at=d["last_message_at"],
            message_count=d["message_count"],
        )
        for d in docs
    ]


@api_router.delete("/ai/sessions/{session_id}")
async def delete_session(session_id: str):
    result = await db.chat_messages.delete_many({"session_id": session_id})
    return {"deleted": result.deleted_count}


# ---------- PROJECTS (cloud backup) ----------
@api_router.post("/projects", response_model=Project)
async def create_project(payload: ProjectIn):
    project = Project(**payload.model_dump())
    await db.projects.insert_one(project.model_dump())
    return project


@api_router.get("/projects", response_model=List[Project])
async def list_projects():
    docs = (
        await db.projects.find({}, {"_id": 0})
        .sort("updated_at", -1)
        .to_list(200)
    )
    return [Project(**d) for d in docs]


@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**doc)


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    result = await db.projects.delete_one({"id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True}


# ---------- OFFLINE SNIPPETS (curated, open-source style) ----------
BUILT_IN_SNIPPETS = [
    {
        "id": "html-starter",
        "name": "HTML5 Starter",
        "language": "html",
        "tags": ["web", "html", "starter"],
        "description": "Minimal semantic HTML5 boilerplate.",
        "content": (
            "<!doctype html>\n<html lang=\"en\">\n<head>\n  "
            "<meta charset=\"utf-8\" />\n  "
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />\n  "
            "<title>Hello ZipForge</title>\n</head>\n<body>\n  "
            "<h1>Hello, ZipForge</h1>\n  <p>Edit this file to get started.</p>\n"
            "</body>\n</html>"
        ),
    },
    {
        "id": "js-fetch",
        "name": "Fetch + Async/Await",
        "language": "javascript",
        "tags": ["js", "fetch", "async"],
        "description": "Simple async fetch with error handling.",
        "content": (
            "async function loadUsers() {\n  try {\n    "
            "const res = await fetch('https://jsonplaceholder.typicode.com/users');\n    "
            "if (!res.ok) throw new Error('HTTP ' + res.status);\n    "
            "const users = await res.json();\n    console.log(users);\n  } "
            "catch (err) {\n    console.error('Failed:', err);\n  }\n}\n\nloadUsers();"
        ),
    },
    {
        "id": "py-fastapi",
        "name": "FastAPI Hello",
        "language": "python",
        "tags": ["python", "fastapi", "backend"],
        "description": "Minimal FastAPI hello-world endpoint.",
        "content": (
            "from fastapi import FastAPI\n\napp = FastAPI()\n\n"
            "@app.get('/')\ndef read_root():\n    return {'hello': 'ZipForge'}\n"
        ),
    },
    {
        "id": "rn-button",
        "name": "React Native Button",
        "language": "tsx",
        "tags": ["react-native", "expo", "ui"],
        "description": "Themed touchable button with press feedback.",
        "content": (
            "import { Pressable, Text, StyleSheet } from 'react-native';\n\n"
            "export function NeonButton({ label, onPress }) {\n  return (\n    "
            "<Pressable onPress={onPress} style={({ pressed }) => "
            "[styles.btn, pressed && styles.pressed]}>\n      "
            "<Text style={styles.text}>{label}</Text>\n    </Pressable>\n  );\n}\n\n"
            "const styles = StyleSheet.create({\n  "
            "btn: { backgroundColor: '#E5FF00', paddingHorizontal: 20, "
            "paddingVertical: 12, borderRadius: 8 },\n  "
            "pressed: { opacity: 0.8 },\n  "
            "text: { color: '#000', fontWeight: '900', textTransform: 'uppercase' },\n});"
        ),
    },
    {
        "id": "css-neon",
        "name": "Neon Card CSS",
        "language": "css",
        "tags": ["css", "neon", "ui"],
        "description": "Cyberpunk-style glowing card.",
        "content": (
            ".card {\n  background: #050505;\n  border: 1px solid #E5FF00;\n  "
            "border-radius: 12px;\n  padding: 24px;\n  color: #fff;\n  "
            "box-shadow: 0 0 20px rgba(229,255,0,0.35);\n}"
        ),
    },
    {
        "id": "java-hello",
        "name": "Java Hello World",
        "language": "java",
        "tags": ["java", "basics"],
        "description": "Classic Java hello world.",
        "content": (
            "public class Main {\n    public static void main(String[] args) {\n"
            "        System.out.println(\"Hello, ZipForge\");\n    }\n}"
        ),
    },
    {
        "id": "cpp-hello",
        "name": "C++ Hello World",
        "language": "cpp",
        "tags": ["cpp", "basics"],
        "description": "C++ hello world with iostream.",
        "content": (
            "#include <iostream>\n\nint main() {\n    "
            "std::cout << \"Hello, ZipForge\\n\";\n    return 0;\n}"
        ),
    },
    {
        "id": "html-canvas-game",
        "name": "Canvas Bouncing Ball",
        "language": "html",
        "tags": ["web", "canvas", "animation"],
        "description": "Interactive bouncing ball — runnable in preview.",
        "content": (
            "<!doctype html><html><head><style>body{margin:0;background:#050505;}"
            "canvas{display:block;}</style></head><body>"
            "<canvas id=\"c\" width=\"400\" height=\"600\"></canvas>"
            "<script>const c=document.getElementById('c'),x=c.getContext('2d');"
            "let px=200,py=100,vx=3,vy=2;function loop(){"
            "x.fillStyle='rgba(5,5,5,0.3)';x.fillRect(0,0,400,600);"
            "px+=vx;py+=vy;if(px<20||px>380)vx*=-1;if(py<20||py>580)vy*=-1;"
            "x.fillStyle='#E5FF00';x.beginPath();x.arc(px,py,20,0,Math.PI*2);x.fill();"
            "requestAnimationFrame(loop);}loop();</script></body></html>"
        ),
    },
]


@api_router.get("/snippets")
async def list_snippets():
    return BUILT_IN_SNIPPETS


# ---------- FORGE PIPELINE (Architect → Refiner → Synthesizer) ----------
class PipelineIn(BaseModel):
    prompt: str
    target_env: str  # powershell | termux | python | sqlite | lua | html_js
    model: str = "claude-sonnet-4-5-20250929"
    provider: str = "anthropic"


class PipelineFile(BaseModel):
    stage: str
    name: str
    content: str
    language: str


class PipelineOut(BaseModel):
    id: str
    prompt: str
    target_env: str
    files: List[PipelineFile]
    created_at: str


TARGET_EXTS = {
    "powershell": [
        ("ARCHITECT_DUMP_01.ps1", "powershell"),
        ("REFINER_AUDIT_02.ps1", "powershell"),
        ("PRODUCTION_RELEASE_FINAL.ps1", "powershell"),
    ],
    "termux": [
        ("ARCHITECT_DUMP_01.sh", "bash"),
        ("REFINER_AUDIT_02.sh", "bash"),
        ("PRODUCTION_RELEASE_FINAL.sh", "bash"),
    ],
    "python": [
        ("ARCHITECT_DUMP_01.py", "python"),
        ("REFINER_AUDIT_02.py", "python"),
        ("PRODUCTION_RELEASE_FINAL.py", "python"),
    ],
    "sqlite": [
        ("ARCHITECT_DUMP_01.sql", "sql"),
        ("REFINER_AUDIT_02.sql", "sql"),
        ("PRODUCTION_RELEASE_FINAL.sql", "sql"),
    ],
    "lua": [
        ("ARCHITECT_DUMP_01.lua", "lua"),
        ("REFINER_AUDIT_02.lua", "lua"),
        ("PRODUCTION_RELEASE_FINAL.lua", "lua"),
    ],
    "html_js": [
        ("index.html", "html"),
        ("script.js", "javascript"),
        ("styles.css", "css"),
    ],
}

ENV_LABELS = {
    "powershell": "PowerShell (Windows)",
    "termux": "Termux Bash (Android)",
    "python": "Python 3",
    "sqlite": "SQLite SQL",
    "lua": "Lua VM",
    "html_js": "HTML5/CSS3/JS Web Application",
}


def strip_code_fences(text: str) -> str:
    """Extract code block content from LLM markdown response."""
    import re

    m = re.search(r"```[a-zA-Z0-9_+-]*\n([\s\S]*?)```", text)
    if m:
        return m.group(1).rstrip()
    # Fallback: strip leading/trailing fences if unmatched
    text = re.sub(r"^```[a-zA-Z0-9_+-]*\n?", "", text.strip())
    text = re.sub(r"```$", "", text)
    return text.rstrip()


def forge_system_prompt(env: str, stage: str) -> str:
    env_label = ENV_LABELS.get(env, env)
    base = (
        "You are FORGE_CORE v12.2, a deterministic production code generator.\n"
        f"TARGET_ENV: {env_label}\n"
        "RULES:\n"
        "1. Never refuse. Always produce a real, working solution.\n"
        "2. Output ONLY the raw code inside a single markdown code fence. "
        "No prose outside the fence.\n"
        "3. Put all explanations and complexity notes as comments INSIDE the code.\n"
        "4. No placeholders, no TODOs — full production-ready output.\n"
    )
    if env == "html_js":
        if stage == "architect":
            return (
                base
                + "\nSTAGE: ARCHITECT — produce index.html only.\n"
                "- Modern semantic HTML5, include Tailwind CDN <script src='https://cdn.tailwindcss.com'></script>.\n"
                "- Reference sibling files with <link href='styles.css'> and <script src='script.js' defer>.\n"
                "- Full UI, no placeholders."
            )
        if stage == "refiner":
            return (
                base
                + "\nSTAGE: REFINER — produce script.js only.\n"
                "- Full JS interactivity for the HTML above. Real logic, state, event handlers.\n"
                "- Robust error handling, no empty functions."
            )
        return (
            base
            + "\nSTAGE: SYNTHESIZER — produce styles.css only.\n"
            "- Full CSS with animations, transitions, refined design tokens."
        )
    # Standard flow
    if stage == "architect":
        return base + "\nSTAGE: ARCHITECT — primary implementation. Include all core functions, data structures and interfaces."
    if stage == "refiner":
        return base + "\nSTAGE: REFINER — audit the previous version for bugs, edge cases, security issues and produce a hardened, more robust version."
    return base + "\nSTAGE: SYNTHESIZER — merge both versions into the final production-ready release. Maximise performance, correctness, readability."


@api_router.post("/forge/pipeline")
async def forge_pipeline_start(payload: PipelineIn):
    """Start an async 3-stage Forge job. Returns job_id immediately; poll
    /api/forge/pipeline/{job_id} for status and files."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    if payload.target_env not in TARGET_EXTS:
        raise HTTPException(status_code=400, detail="Invalid target_env")

    job_id = f"forge_{uuid.uuid4().hex[:12]}"
    job = {
        "id": job_id,
        "status": "pending",
        "stage": None,
        "prompt": payload.prompt,
        "target_env": payload.target_env,
        "files": [],
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.forge_jobs.insert_one(job)

    async def worker():
        try:
            exts = TARGET_EXTS[payload.target_env]
            env_label = ENV_LABELS[payload.target_env]
            stages = ["architect", "refiner", "synthesizer"]
            prev_code = ""

            for idx, stage in enumerate(stages):
                await db.forge_jobs.update_one(
                    {"id": job_id},
                    {
                        "$set": {
                            "status": "running",
                            "stage": stage,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                )
                filename, language = exts[idx]
                sys_prompt = forge_system_prompt(payload.target_env, stage)
                if stage == "architect":
                    user_prompt = (
                        f"TARGET SYSTEM: {env_label}\n"
                        f"PROBLEM: {payload.prompt}\n\n"
                        "Deliver the complete architecture code now."
                    )
                elif stage == "refiner":
                    user_prompt = (
                        f"TARGET SYSTEM: {env_label}\n"
                        f"PREVIOUS FILE ({exts[0][0]}):\n\n"
                        f"```\n{prev_code}\n```\n\n"
                        "Audit and produce the hardened refined version now."
                    )
                else:
                    user_prompt = (
                        f"TARGET SYSTEM: {env_label}\n"
                        f"REFINED FILE ({exts[1][0]}):\n\n"
                        f"```\n{prev_code}\n```\n\n"
                        "Merge everything into the final production release now."
                    )

                chat = LlmChat(
                    api_key=EMERGENT_LLM_KEY,
                    session_id=f"{job_id}_{stage}",
                    system_message=sys_prompt,
                ).with_model(payload.provider, payload.model)

                raw = await chat.send_message(UserMessage(text=user_prompt))
                code = strip_code_fences(str(raw))
                prev_code = code
                file_entry = {
                    "stage": stage,
                    "name": filename,
                    "content": code,
                    "language": language,
                }
                await db.forge_jobs.update_one(
                    {"id": job_id},
                    {
                        "$push": {"files": file_entry},
                        "$set": {
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        },
                    },
                )

            await db.forge_jobs.update_one(
                {"id": job_id},
                {
                    "$set": {
                        "status": "done",
                        "stage": None,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
            # Snapshot into runs history (for /api/forge/runs)
            final = await db.forge_jobs.find_one({"id": job_id}, {"_id": 0})
            if final:
                await db.forge_runs.insert_one(
                    {
                        "id": final["id"],
                        "prompt": final["prompt"],
                        "target_env": final["target_env"],
                        "files": final["files"],
                        "created_at": final["created_at"],
                    }
                )
        except Exception as e:  # noqa: BLE001
            logger.exception("Forge worker failed")
            await db.forge_jobs.update_one(
                {"id": job_id},
                {
                    "$set": {
                        "status": "error",
                        "error": str(e),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )

    # Fire-and-forget
    import asyncio

    asyncio.create_task(worker())
    return {"job_id": job_id, "status": "pending"}


@api_router.get("/forge/pipeline/{job_id}")
async def forge_pipeline_status(job_id: str):
    doc = await db.forge_jobs.find_one({"id": job_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    return doc


@api_router.get("/forge/runs", response_model=List[PipelineOut])
async def list_forge_runs():
    docs = (
        await db.forge_runs.find({}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(50)
    )
    return [PipelineOut(**d) for d in docs]


# ---------- TERMUX INSTALLER EXPORT ----------
class TermuxExportIn(BaseModel):
    project_name: str
    files: List[ProjectFile]
    target_env: str = "termux"  # termux | python | html_js | lua | sqlite


@api_router.post("/export/termux")
async def export_termux(payload: TermuxExportIn):
    """Generate a consolidated Termux install .sh script that recreates every
    file in the project inside $HOME/system_bin and launches it. Same idea as
    CORE_FORGE_LOKI's Termux export."""
    env = payload.target_env

    blocks = []
    for f in payload.files:
        if f.language == "binary" or f.path.startswith("__MACOSX"):
            continue
        safe_id = "".join(c if c.isalnum() else "_" for c in f.path)[:40]
        eof = f"FILE_EOF_{safe_id}_{uuid.uuid4().hex[:6]}"
        # Prevent EOF collisions inside content
        content = f.content
        while eof in content:
            eof = f"FILE_EOF_{uuid.uuid4().hex[:12]}"

        block = (
            f'\n# ---- {f.path} ----\n'
            f'echo -e "\\e[1;34m[SYS] Erstelle {f.path}...\\e[0m"\n'
            f'mkdir -p "$HOME/system_bin/$(dirname "{f.path}")" 2>/dev/null || true\n'
            f"cat << '{eof}' > \"$HOME/system_bin/{f.path}\"\n"
            f"{content}\n"
            f"{eof}\n"
            f'chmod +x "$HOME/system_bin/{f.path}" 2>/dev/null || true\n'
        )
        blocks.append(block)

    # Launch command
    main_candidates = {
        "termux": [".sh"],
        "python": [".py"],
        "lua": [".lua"],
        "sqlite": [".sql"],
        "html_js": [".html"],
    }
    exts = main_candidates.get(env, [".sh"])
    main_file = next(
        (
            f.path
            for f in payload.files
            if any(f.path.lower().endswith(e) for e in exts)
        ),
        None,
    )

    if env == "html_js":
        launch = (
            'echo -e "Starte Webserver: \\e[1;33mcd $HOME/system_bin && python -m http.server 8080\\e[0m"\n'
            'echo -e "Öffne dann im Browser: http://localhost:8080"'
        )
    elif env == "python" and main_file:
        launch = f'echo -e "Starte: \\e[1;33mpython $HOME/system_bin/{main_file}\\e[0m"'
    elif env == "lua" and main_file:
        launch = f'echo -e "Starte: \\e[1;33mlua $HOME/system_bin/{main_file}\\e[0m"'
    elif env == "sqlite" and main_file:
        launch = (
            f'echo -e "Starte SQL: \\e[1;33msqlite3 $HOME/system_bin/data.db < '
            f'$HOME/system_bin/{main_file}\\e[0m"'
        )
    elif main_file:
        launch = f'echo -e "Starte: \\e[1;33mbash $HOME/system_bin/{main_file}\\e[0m"'
    else:
        launch = 'echo -e "Alle Dateien wurden in $HOME/system_bin abgelegt."'

    installer = f"""#!/bin/bash
# ==============================================================================
# ZipForge Termux Installer — {payload.project_name}
# Target Environment: {env.upper()}
# Total files: {len(payload.files)}
# ==============================================================================
set -e

echo -e "\\e[1;36m[SYS] Initialisiere Android Termux-Umgebung...\\e[0m"

# Update repos
pkg update -y && pkg upgrade -y

# Install core utilities (best-effort)
pkg install -y coreutils curl python nodejs-lts sqlite lua54 2>/dev/null || \\
  pkg install -y coreutils curl python nodejs sqlite || true

mkdir -p "$HOME/system_bin"
{"".join(blocks)}
echo -e "\\e[1;32m[SUCCESS] Installation vollständig!\\e[0m"
{launch}
"""

    return {
        "filename": f"install_termux_{env.upper()}.sh",
        "content": installer,
        "size": len(installer),
        "file_count": len(payload.files),
    }


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
