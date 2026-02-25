import os

def files():
    """
    Recursively scans the current directory for files and folders, 
    ignoring common build and environment directories.
    """
    out = []
    ignore_dirs = {".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode", "dist", "build"}
    for r, d, f in os.walk("."):
        # Prune ignored directories
        d[:] = [dirname for dirname in d if dirname not in ignore_dirs and not dirname.startswith(".")]
        
        # Current relative path from root, formatted nicely
        rel_r = r[2:] if r.startswith("./") or r.startswith(".\\") else (r if r != "." else "")
        
        for x in d:
            path = os.path.join(rel_r, x).replace("\\", "/") + "/"
            out.append(path)
        for x in f:
            if not x.startswith("."):
                path = os.path.join(rel_r, x).replace("\\", "/")
                out.append(path)
    return sorted(out)
