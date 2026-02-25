
from pathlib import Path
import difflib

def apply(changes):
    """
    Applies a list of requested file changes to the local filesystem.
    
    Args:
        changes: A list of dicts, each containing 'file', 'original', and 'edited' content.
    """
    for c in changes:
        p = Path(c["file"])
        # Ensure parent directory exists
        p.parent.mkdir(parents=True, exist_ok=True)
        
        if p.exists():
            t = p.read_text()
            if c["original"]:
                if c["original"] not in t:
                    raise RuntimeError(f"Mismatch in {c['file']}")
                new = t.replace(c["original"], c["edited"], 1)
            else:
                # If original is empty but file exists, we replace the whole file?
                # Or maybe we append? Prompt says "For NEW files".
                # Let's assume empty original means full replacement if file exists too, 
                # but focus on the "New File" use case.
                new = c["edited"]
        else:
            new = c["edited"]
            
        p.write_text(new, encoding="utf-8")
