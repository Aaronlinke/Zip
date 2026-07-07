"""ZipForge API integration tests"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://app-innovation-hub-5.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Health ----------
def test_root_online(s):
    r = s.get(f"{API}/", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "online"


# ---------- Snippets ----------
def test_snippets_count(s):
    r = s.get(f"{API}/snippets", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 8
    assert all("id" in x and "content" in x and "language" in x for x in data)


# ---------- AI Chat ----------
class TestAIChat:
    session_id = f"test_{uuid.uuid4().hex[:8]}"

    def test_chat_simple(self, s):
        r = s.post(
            f"{API}/ai/chat/simple",
            json={"session_id": self.session_id, "message": "Say the single word: PONG"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "assistant"
        assert len(data["content"]) > 0

    def test_chat_with_code_context(self, s):
        r = s.post(
            f"{API}/ai/chat/simple",
            json={
                "session_id": self.session_id,
                "message": "In one word, what language is this?",
                "code_context": "def hello():\n    print('hi')",
                "file_name": "hello.py",
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["content"]) > 0

    def test_session_messages_history(self, s):
        r = s.get(f"{API}/ai/sessions/{self.session_id}/messages", timeout=30)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 4  # 2 user + 2 assistant
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles

    def test_list_sessions(self, s):
        r = s.get(f"{API}/ai/sessions", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert any(x["id"] == self.session_id for x in data)

    def test_delete_session(self, s):
        r = s.delete(f"{API}/ai/sessions/{self.session_id}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted", 0) >= 4
        # Verify empty
        r2 = s.get(f"{API}/ai/sessions/{self.session_id}/messages", timeout=30)
        assert r2.status_code == 200
        assert r2.json() == []


# ---------- Projects CRUD ----------
class TestProjects:
    created_id = None

    def test_create_project(self, s):
        payload = {
            "name": "TEST_project_zf",
            "files": [{"path": "a.txt", "content": "hi", "size": 2, "language": "text"}],
            "tech_stack": ["Web"],
        }
        r = s.post(f"{API}/projects", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_project_zf"
        assert data["id"]
        TestProjects.created_id = data["id"]

    def test_list_projects(self, s):
        r = s.get(f"{API}/projects", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert any(p["id"] == TestProjects.created_id for p in data)

    def test_get_project(self, s):
        r = s.get(f"{API}/projects/{TestProjects.created_id}", timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == TestProjects.created_id

    def test_delete_project(self, s):
        r = s.delete(f"{API}/projects/{TestProjects.created_id}", timeout=30)
        assert r.status_code == 200
        # Verify 404
        r2 = s.get(f"{API}/projects/{TestProjects.created_id}", timeout=30)
        assert r2.status_code == 404


# ---------- Forge Pipeline ----------
class TestForgePipeline:
    def test_pipeline_html_js(self, s):
        r = s.post(
            f"{API}/forge/pipeline",
            json={
                "prompt": "Simple counter button that increments on click",
                "target_env": "html_js",
            },
            timeout=180,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        files = data["files"]
        assert len(files) == 3
        names = [f["name"] for f in files]
        assert "index.html" in names
        assert "script.js" in names
        assert "styles.css" in names
        stages = [f["stage"] for f in files]
        assert stages == ["architect", "refiner", "synthesizer"]
        for f in files:
            assert len(f["content"]) > 20

    def test_pipeline_python(self, s):
        r = s.post(
            f"{API}/forge/pipeline",
            json={"prompt": "Print hello world once", "target_env": "python"},
            timeout=180,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        files = data["files"]
        assert len(files) == 3
        for f in files:
            assert f["name"].endswith(".py")
            assert len(f["content"]) > 5

    def test_forge_runs_list(self, s):
        r = s.get(f"{API}/forge/runs", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1


# ---------- Termux Export ----------
def test_export_termux(s):
    payload = {
        "project_name": "TEST_termux",
        "files": [
            {"path": "run.sh", "content": "echo hello", "size": 10, "language": "bash"},
            {"path": "helper.sh", "content": "echo world", "size": 10, "language": "bash"},
        ],
        "target_env": "termux",
    }
    r = s.post(f"{API}/export/termux", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    content = data["content"]
    assert content.startswith("#!/bin/bash")
    assert "pkg install" in content
    assert "run.sh" in content
    assert "helper.sh" in content
    assert data["file_count"] == 2
