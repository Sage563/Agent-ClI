
import json
import time
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

SESSIONS_DIR = Path("sessions")
if not SESSIONS_DIR.exists():
    SESSIONS_DIR.mkdir()

DEFAULT_SESSION = "default"
ACTIVE_SESSION_FILE = Path(".active_session")

def get_active_session_name():
    """Returns the name of the currently active session from the .active_session file."""
    if ACTIVE_SESSION_FILE.exists():
        return ACTIVE_SESSION_FILE.read_text().strip()
    return DEFAULT_SESSION

def set_active_session_name(name: str):
    ACTIVE_SESSION_FILE.write_text(name)

def get_session_path(name: str):
    return SESSIONS_DIR / f"{name}.json"

def load(name: Optional[str] = None):
    if name is None:
        name = get_active_session_name()
    
    path = get_session_path(name)
    if not path.exists():
        return {"name": name, "session": [], "metadata": {"created_at": time.time()}}
    
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"name": name, "session": [], "metadata": {"created_at": time.time()}}

def save(data, name: Optional[str] = None):
    if name is None:
        name = data.get("name", get_active_session_name())
    
    path = get_session_path(name)
    path.write_text(json.dumps(data, indent=2))

def add(entry, name: Optional[str] = None):
    data = load(name)
    if "session" not in data: data["session"] = []
    
    if "role" not in entry:
        entry["role"] = "user" if "input" in entry else "assistant"
    
    stored_entry = {
        "role": entry.get("role", "user"),
        "content": entry.get("input") if entry.get("role") == "user" else entry.get("response", entry.get("plan", "")),
        "changes": entry.get("changes", 0),
        "time": entry.get("time", time.time())
    }
    
    data["session"].append(stored_entry)
    save(data, name)

def inject(limit=30):
    data = load()
    history = []
    session = data.get("session", [])
    
    if limit is not None and limit > 0:
        session = session[-limit:]
        
    for item in session:
        role = item.get("role", "user")
        content = item.get("content", "")
        if role == "user":
            history.append(f"User: {content}")
        else:
            changes = item.get("changes", 0)
            history.append(f"Assistant: {content}" + (f" (Applied {changes} changes)" if changes > 0 else ""))
            
    return "\n".join(history)

def list_sessions():
    sessions = []
    for f in SESSIONS_DIR.glob("*.json"):
        sessions.append(f.stem)
    return sessions

def delete_session(name: str):
    path = get_session_path(name)
    if path.exists():
        path.unlink()
    if get_active_session_name() == name:
        set_active_session_name(DEFAULT_SESSION)

def clear():
    name = get_active_session_name()
    save({"name": name, "session": [], "metadata": {"created_at": time.time()}}, name)

def rename_session(old_name: str, new_name: str):
    old_path = get_session_path(old_name)
    new_path = get_session_path(new_name)
    if old_path.exists():
        data = load(old_name)
        data["name"] = new_name
        save(data, new_name)
        old_path.unlink()
        if get_active_session_name() == old_name:
            set_active_session_name(new_name)
        return True
    return False

# Legacy compatibility for snapshot/restore (can be mapped to specific named sessions if needed)
def snapshot():
    name = get_active_session_name()
    data = load(name)
    save(data, f"{name}_backup")

def restore():
    name = get_active_session_name()
    backup_name = f"{name}_backup"
    path = get_session_path(backup_name)
    if path.exists():
        data = load(backup_name)
        data["name"] = name
        save(data, name)
        return True
    return False
