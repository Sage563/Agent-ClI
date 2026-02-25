import os
from pathlib import Path
from memory import inject

def get_project_map(startpath='.'):
    ignore_dirs = {".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode", "dist", "build"}
    map_data = []
    for root, dirs, files in os.walk(startpath):
        dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
        rel_root = os.path.relpath(root, startpath)
        if rel_root == ".": rel_root = ""
        for f in files:
            if not f.startswith("."):
                map_data.append(os.path.join(rel_root, f))
    return "\n".join(map_data)

def build(text, plan, fast=False, mission_data=None):
    """
    Constructs the standardized task object to be sent to the LLM provider.
    
    Args:
        text: The raw user instruction/prompt.
        plan: Boolean indicating if this is planning-only mode.
        fast: Boolean indicating if fast mode is enabled.
        mission_data: Optional dictionary containing context from previous autonomous steps.
        
    Returns:
        Dict: A structured task containing instruction, context files, and history.
    """
    context_files = []
    # Improved robust parsing for @file
    words = text.split()
    instruction_parts = []
    
    for word in words:
        if word.startswith("@"):
            file_path = word[1:]
            p = Path(file_path)
            if p.exists():
                content_for_instruction = f"\n--- {word} CONTENT ---\n"
                if p.is_file():
                    try:
                        content = p.read_text(encoding='utf-8', errors='replace')
                        context_files.append({
                            "file": str(p.absolute()),
                            "content": content
                        })
                        content_for_instruction += content
                    except Exception as e:
                        msg = f"Failed to read file: {e}"
                        context_files.append({
                            "file": str(p.absolute()),
                            "error": msg
                        })
                        content_for_instruction += msg
                elif p.is_dir():
                    # Recursive search for files, skipping common ignore patterns
                    ignore_patterns = {".git", "venv", "__pycache__", "node_modules", ".pytest_cache", ".vscode", "dist", "build"}
                    dir_content = ""
                    try:
                        for file in p.rglob("*"):
                            if file.is_file():
                                if any(part in ignore_patterns or part.startswith(".") for part in file.parts):
                                    continue
                                try:
                                    # Simple binary check
                                    with open(file, 'rb') as f:
                                        if b'\x00' in f.read(1024):
                                            continue
                                    
                                    f_content = file.read_text(encoding='utf-8', errors='replace')
                                    context_files.append({
                                        "file": str(file.absolute()),
                                        "content": f_content
                                    })
                                    dir_content += f"\nFILE: {file}\n{f_content}\n"
                                except Exception:
                                    continue
                        content_for_instruction += dir_content if dir_content else "(empty or ignored directory)"
                    except Exception as e:
                        msg = f"Failed to list directory: {e}"
                        context_files.append({
                            "directory": str(p.absolute()),
                            "error": msg
                        })
                        content_for_instruction += msg
                
                content_for_instruction += f"\n--- END {word} CONTENT ---\n"
                instruction_parts.append(content_for_instruction)
            else:
                instruction_parts.append(word) # Keep as is if path doesn't exist
        else:
            instruction_parts.append(word)
            
    return {
        "mode": "plan" if plan else "apply",
        "fast": fast,
        "instruction": " ".join(instruction_parts),
        "raw_input": text,
        "context_files": context_files,
        "session_history": inject(limit=40),
        "mission_data": mission_data,
        "project_map": get_project_map() if plan else None
    }
