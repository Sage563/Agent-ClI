from prompt_toolkit import PromptSession
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.styles import Style
from file_browser import files
from config import cfg

class AtCompleter(Completer):
    def get_completions(self, doc, _):
        t = doc.text_before_cursor
        if "@" not in t: return
        
        # Get the part after the last @
        parts = t.split("@")
        p = parts[-1]
        
        # If there's a space after @, we might be starting a new word, not a file path
        # But usually @ is used without spaces for paths.
        if " " in p:
            return
        
        for f in files():
            # Substring match (case-insensitive)
            if p.lower() in f.lower():
                # Display only the relative path or filename
                display_name = f
                yield Completion(f, start_position=-len(p), display=display_name)

def get_toolbar():
    from memory import get_active_session_name
    session_name = get_active_session_name()
    provider = cfg.get_active_provider()
    planning = "PLAN" if cfg.is_planning_mode() else ""
    fast = "FAST" if cfg.is_fast_mode() else ""
    policy = f"RUN:{cfg.get_run_policy().upper()}"
    
    parts = [
        ("class:toolbar", f" Provider: "),
        ("class:provider", f"{provider} "),
        ("class:toolbar", f" | Session: "),
        ("class:mode", f"{session_name} "),
    ]
    if planning:
        parts.append(("class:mode", f" | {planning}"))
    if fast:
        parts.append(("class:mode", f" | {fast}"))
    
    parts.append(("class:policy", f" | {policy}"))
        
    parts.append(("class:toolbar", " | @ to attach file | /help for commands"))
    return parts

style = Style.from_dict({
    "toolbar": "#ffffff bg:#333333",
    "provider": "#00ff00 bg:#333333 bold",
    "mode": "#ffff00 bg:#333333 bold",
    "policy": "#00ffff bg:#333333 bold",
    "prompt": "#00aa00 bold",
})

def loop(cb):
    kb = KeyBindings()
    
    @kb.add('c-j')
    @kb.add('escape', 'enter')
    @kb.add('f5')
    def _(event):
        event.current_buffer.validate_and_handle()

    s = PromptSession(
        completer=AtCompleter(), 
        multiline=True,
        bottom_toolbar=get_toolbar,
        style=style,
        key_bindings=kb
    )
    
    while True:
        try:
            # Custom prompt showing working directory
            v = s.prompt("agent-cli > ", rprompt="[F5 or Ctrl+Enter to submit]")
            if v.strip().lower() in ("exit", "quit", "/exit", "/quit"): break
            if v.strip(): cb(v)
        except KeyboardInterrupt:
            continue
        except EOFError:
            break
