"""
Agent CLI Main Entry Point
Orchestrates the terminal UI, mission logic, tool execution, and LLM communication.
"""

import argparse
import json
import subprocess
import time
import os
import sys
import threading
from pathlib import Path
from typing import Optional, List, Dict

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule

from input_mode import loop
from task_builder import build
from applier import apply
from memory import add
from config import cfg
import cost as from_cost

# Providers
from providers.ollama import OllamaProvider
from providers.openai import OpenAIProvider
from providers.anthropic import AnthropicProvider
from providers.gemini import GeminiProvider
from providers.deepseek import DeepSeekProvider

import pyttsx3

import difflib
from rich.syntax import Syntax
from rich.columns import Columns

PROMPT = Path("agent.prompt.txt").read_text()
console = Console()
LAST_DEBUG_DATA = {"user_input": None, "task": None, "response": None}
DEBUG_HISTORY = []
SESSION_STATS = {"input_tokens": 0, "output_tokens": 0, "total_cost": 0.0}

def speak_text(text: str):
    def _speak():
        try:
            engine = pyttsx3.init()
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            pass # Silent error for background thread
    threading.Thread(target=_speak, daemon=True).start()

def get_provider(name: str):
    if name == "ollama": return OllamaProvider()
    if name == "openai": return OpenAIProvider()
    if name == "anthropic": return AnthropicProvider()
    if name == "gemini": return GeminiProvider()
    if name == "deepseek": return DeepSeekProvider()
    raise ValueError(f"Unknown provider: {name}")

def handle_command(text: str, args) -> bool:
    """Returns True if a command was handled, False otherwise."""
    parts = text.strip().split()
    cmd = parts[0].lower()
    
    if cmd in ("/exit", "/quit"):
        sys.exit(0)
        
    if cmd == "/help":
        console.print(Panel(Markdown("""
# Available Commands
- `/provider [name]`: Switch provider (ollama [bold green](qwen 2.5)[/bold green], openai, anthropic, gemini, deepseek)
- `/plan [prompt]`: Generate a deep technical plan with full project context (doesn't apply changes)
- `/planning`: Toggle always-plan mode
- `/fast`: Toggle fast mode (skip post-apply review)
- `/run_policy [ask|always|never]`: Set run policy
- `/cls`: Clear the terminal screen
- `/config [key] [value]`: Set configuration (e.g. `/config openai_api_key sk-...`)
- `/code`: Open current directory in VS Code
- `/reset`: Clear agent memory
- `/voice`: Toggle AI voice output
- `/newline`: Toggle literal \\n support
- `/debug [n]`: Show last [n] exchanges with full JSON data
- `/history [n|all]`: Show session history highlights (n is count)
- `/stats`: Show session token usage and cost
- `/mission`: Toggle continuous mission mode
- `/visibility`: Toggle project visibility permission for agent
- `/session [list|new|load|delete|rename]`: Manage chat sessions
- `/web`: Toggle web browsing support (search & browse)
- `/help`: Show this help message
- `/exit`: Exit the agent
        """), title="Help", border_style="blue"))
        return True
        
    if cmd == "/web":
        current = cfg.is_web_browsing_allowed()
        cfg.set_web_browsing_allowed(not current)
        console.print(f"[yellow]Web browsing:[/yellow] {'[bold green]ENABLED[/bold green]' if not current else '[bold red]DISABLED[/bold red]'}")
        if not current:
            console.print("[dim]The agent can now use `web_search` and `web_browse` functions.[/dim]")
        return True

    if cmd == "/planning":
        current = cfg.is_planning_mode()
        cfg.set_planning_mode(not current)
        console.print(f"[yellow]Planning mode:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        return True

    if cmd == "/fast":
        current = cfg.is_fast_mode()
        cfg.set_fast_mode(not current)
        console.print(f"[yellow]Fast mode:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        return True
        
    if cmd in ("/cls", "/clear_screen"):
        console.clear()
        return True

    if cmd == "/run_policy":
        if len(parts) < 2:
            console.print(f"[bold]Current run policy:[/bold] {cfg.get_run_policy()}")
            console.print("Available: ask, always, never")
        else:
            policy = parts[1].lower()
            if policy in ("ask", "always", "never"):
                cfg.set_run_policy(policy)
                console.print(f"[green]Run policy set to:[/green] {policy}")
            else:
                console.print(f"[red]Unknown policy:[/red] {policy}")
        return True
    if cmd == "/plan":
        if len(parts) < 2:
            console.print("[red]Usage:[/red] /plan <instruction>")
            return True
        instruction = " ".join(parts[1:])
        # Create a temporary args object with plan=True
        plan_args = argparse.Namespace(**vars(args))
        plan_args.plan = True
        handle(instruction, plan_args)
        return True

    if cmd == "/provider":
        if len(parts) < 2:
            current = cfg.get_active_provider()
            console.print(f"[bold]Current provider:[/bold] {current}")
            console.print("Available: ollama [bold green](qwen 2.5)[/bold green], openai, anthropic, gemini")
        else:
            new_provider = parts[1].lower()
            if new_provider in ["ollama", "openai", "anthropic", "gemini", "deepseek"]:
                cfg.set_active_provider(new_provider)
                console.print(f"[green]Switched to provider:[/green] {new_provider}")
            else:
                console.print(f"[red]Unknown provider:[/red] {new_provider}")
        return True
        
    if cmd == "/config":
        if len(parts) < 3:
             console.print("[red]Usage:[/red] /config <key> <value>")
        else:
            key = parts[1]
            val = " ".join(parts[2:])
            
            if key.endswith("_api_key") or key == "ollama_endpoint":
                provider_name = key.replace("_api_key", "").replace("ollama_endpoint", "ollama")
                
                if provider_name in ["openai", "anthropic", "gemini", "deepseek", "ollama"]:
                    with console.status(f"[bold yellow]Validating {key}...[/bold yellow]", spinner="dots"):
                        # Save old value for potential rollback
                        if key.endswith("_api_key"):
                            old_val = cfg.get_api_key(provider_name)
                            cfg.set_api_key(provider_name, val)
                        else:
                            old_val = cfg.get_provider_config("ollama").get("endpoint")
                            cfg.set_ollama_endpoint(val)
                            
                        try:
                            # We import get_provider locally to avoid circular imports if any
                            provider_obj = get_provider(provider_name)
                            is_valid, msg = provider_obj.validate()
                            
                            if is_valid:
                                console.print(f"[bold green]✓ {msg}[/bold green]")
                            else:
                                console.print(f"[bold red]✗ Validation Failed:[/bold red] {msg}")
                                if console.input("[yellow]Save anyway? (y/n): [/yellow]").lower() != 'y':
                                    # Rollback
                                    if key.endswith("_api_key"):
                                        cfg.set_api_key(provider_name, old_val if old_val else "")
                                    else:
                                        cfg.set_ollama_endpoint(old_val if old_val else "")
                                    console.print("[yellow]Changes discarded.[/yellow]")
                                    return True
                                else:
                                    console.print("[yellow]Warning: Saving potentially invalid configuration.[/yellow]")
                        except Exception as e:
                            console.print(f"[yellow]Could not perform validation: {e}[/yellow]")
                else:
                    console.print(f"[red]Unknown provider:[/red] {provider_name}")
            elif key.endswith("_max_tokens"):
                provider_name = key.replace("_max_tokens", "")
                if provider_name in ["openai", "anthropic", "gemini", "deepseek", "ollama"]:
                    if val.lower() in ["unlimited", "max", "none"]:
                        # For Anthropic, we need a value, so we'll set a high default if "unlimited"
                        # For OpenAI/Gemini/DeepSeek, we can often just remove it or set very high
                        cfg.set_generation_param(provider_name, "max_tokens" if provider_name != "gemini" else "max_output_tokens", None)
                        console.print(f"[green]Set {provider_name} tokens to unlimited.[/green]")
                    else:
                        try:
                            tokens = int(val)
                            param_key = "max_tokens" if provider_name != "gemini" else "max_output_tokens"
                            cfg.set_generation_param(provider_name, param_key, tokens)
                            console.print(f"[green]Set {provider_name} max tokens to {tokens}.[/green]")
                        except ValueError:
                            console.print(f"[red]Invalid token count:[/red] {val}")
                else:
                    console.print(f"[red]Unknown provider for max tokens:[/red] {provider_name}")
            else:
                console.print("[red]Unknown config key. Supported: *_api_key, ollama_endpoint, *_max_tokens[/red]")
        return True

    if cmd in ("/reset", "/clear"):
        from memory import clear
        clear()
        console.print("[bold red]Memory cleared.[/bold red]")
        return True

    if cmd in ("/code", "/vs"):
        try:
            subprocess.Popen(["code", "."] if sys.platform == "win32" else ["code", "."])
        except FileNotFoundError:
            console.print("[red]VS Code command 'code' not found in PATH.[/red]")
        return True

    if cmd == "/voice":
        current = cfg.is_voice_mode()
        cfg.set_voice_mode(not current)
        console.print(f"[yellow]Voice mode:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        return True

    if cmd == "/newline":
        current = cfg.is_newline_support()
        cfg.set_newline_support(not current)
        console.print(f"[yellow]Newline support:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        return True

    if cmd == "/debug":
        limit = 1
        if len(parts) > 1:
            try:
                limit = int(parts[1])
            except ValueError:
                console.print(f"[red]Invalid debug history limit:[/red] {parts[1]}")
                return True
        
        if not DEBUG_HISTORY:
            console.print("[yellow]No interaction data available yet.[/yellow]")
        else:
            for i, entry in enumerate(DEBUG_HISTORY[-limit:]):
                title = f"Debug: Exchange {len(DEBUG_HISTORY) - limit + i + 1}"
                debug_out = {
                    "user_input": entry["user_input"],
                    "task_sent": entry["task"],
                    "raw_response": entry["response"]
                }
                # Render with actual newlines for readability in the terminal
                json_str = json.dumps(debug_out, indent=2)
                readable_out = json_str.replace("\\n", "\n")
                console.print(Panel(Syntax(readable_out, "json", theme="monokai"), title=title, border_style="magenta"))
        return True
    
    if cmd == "/history":
        from memory import load
        data = load()
        session = data.get("session", [])
        if not session:
            console.print("[yellow]No session history yet.[/yellow]")
        else:
            limit = 10 # default display limit
            if len(parts) > 1:
                if parts[1].lower() == "all":
                    limit = len(session)
                else:
                    try:
                        limit = int(parts[1])
                    except ValueError:
                        console.print(f"[red]Invalid history limit:[/red] {parts[1]}")
                        return True
            
            from rich.table import Table
            ht = Table(title=f"Session History (Showing last {min(limit, len(session))})", border_style="cyan")
            ht.add_column("Time", style="dim")
            ht.add_column("Role", style="bold")
            ht.add_column("Content", ratio=1)
            
            for item in session[-limit:]:
                t_val = item.get("time", 0)
                t_str = time.strftime("%H:%M:%S", time.localtime(t_val)) if t_val else "N/A"
                ht.add_row(t_str, item.get("role", ""), item.get("content", "")[:150].replace("\n", " ") + "...")
            console.print(ht)
        return True

    if cmd == "/stats":
        from rich.table import Table
        st = Table(title="Session Statistics", border_style="green")
        st.add_column("Metric", style="bold")
        st.add_column("Value", justify="right")
        st.add_row("Input Tokens", f"{SESSION_STATS['input_tokens']:,}")
        st.add_row("Output Tokens", f"{SESSION_STATS['output_tokens']:,}")
        st.add_row("Total Tokens", f"{SESSION_STATS['input_tokens'] + SESSION_STATS['output_tokens']:,}")
        st.add_row("Total Cost", f"${SESSION_STATS['total_cost']:.4f}")
        console.print(Panel(st, border_style="bright_black"))
        return True

    if cmd == "/session":
        from memory import list_sessions, set_active_session_name, delete_session, get_active_session_name, rename_session
        if len(parts) < 2:
            current = get_active_session_name()
            console.print(f"[bold]Active Session:[/bold] [cyan]{current}[/cyan]")
            console.print("Subcommands: list, new, load, delete, rename")
            return True
        
        sub = parts[1].lower()
        if sub == "list":
            sessions = list_sessions()
            console.print("[bold]Available Sessions:[/bold]")
            for s in sessions:
                star = "*" if s == get_active_session_name() else " "
                console.print(f" {star} {s}")
        elif sub == "new":
            name = parts[2] if len(parts) > 2 else f"session_{int(time.time())}"
            set_active_session_name(name)
            console.print(f"[green]Started new session:[/green] [cyan]{name}[/cyan]")
        elif sub == "load":
            if len(parts) < 3:
                console.print("[red]Usage:[/red] /session load <name>")
            else:
                name = parts[2]
                if name in list_sessions():
                    set_active_session_name(name)
                    console.print(f"[green]Switched to session:[/green] [cyan]{name}[/cyan]")
                else:
                    console.print(f"[red]Session not found:[/red] {name}")
        elif sub == "delete":
            if len(parts) < 3:
                console.print("[red]Usage:[/red] /session delete <name>")
            else:
                name = parts[2]
                delete_session(name)
                console.print(f"[red]Deleted session:[/red] {name}")
        elif sub == "rename":
            if len(parts) < 3:
                console.print("[red]Usage:[/red] /session rename <new_name>")
            else:
                old_name = get_active_session_name()
                new_name = parts[2]
                if rename_session(old_name, new_name):
                    console.print(f"[green]Renamed session to:[/green] [cyan]{new_name}[/cyan]")
                else:
                    console.print(f"[red]Rename failed.[/red]")
        return True

    if cmd == "/mission":
        current = cfg.is_mission_mode()
        cfg.set_mission_mode(not current)
        console.print(f"[yellow]Mission mode:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        if not current:
            console.print("[dim]The agent will now work autonomously until the task is complete.[/dim]")
        return True

    if cmd == "/visibility":
        current = cfg.is_visibility_allowed()
        cfg.set_visibility_allowed(not current)
        console.print(f"[yellow]Full visibility:[/yellow] {'[bold green]ALLOWED[/bold green]' if not current else '[bold red]DENIED[/bold red]'}")
        return True

    if cmd == "/store":
        from memory import snapshot
        snapshot()
        console.print("[bold green]Session snapshot stored.[/bold green]")
        return True

    if cmd == "/persist":
        current = cfg.is_auto_reload_enabled()
        cfg.set_auto_reload(not current)
        console.print(f"[yellow]Session persistence:[/yellow] {'[bold green]ON[/bold green]' if not current else '[bold red]OFF[/bold red]'}")
        return True

    return False

def web_search(query: str) -> str:
    """Performs a web search using DuckDuckGo with expanded results and news."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            # Try to get news results as well if it looks like a timely query
            news_output = ""
            try:
                news = list(ddgs.news(query, max_results=3))
                if news:
                    news_output = "RECENT NEWS:\n"
                    for n in news:
                        news_output += f"- {n['title']} ({n['date']})\n  URL: {n['url']}\n"
                    news_output += "\n"
            except: pass

            results = list(ddgs.text(query, max_results=8))
            if not results:
                return "No search results found."
            
            output = f"Search results for: {query}\n\n"
            if news_output: output += news_output
            
            output += "WEB RESULTS:\n"
            for i, r in enumerate(results, 1):
                output += f"{i}. {r['title']}\n"
                output += f"   URL: {r['href']}\n"
                output += f"   Snippet: {r['body']}\n\n"
            
            output += "Note: Use `web_browse <url>` to read the full content of any specific result above."
            return output
    except Exception as e:
        return f"Error performing web search: {e}"

def web_browse(url: str) -> str:
    """Fetches and extracts content from a URL using trafilatura."""
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if downloaded is None:
            # Fallback to requests for basic fetching if trafilatura fails
            import requests
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            downloaded = r.text
        
        content = trafilatura.extract(downloaded)
        if not content:
            return "Failed to extract readable content from the page."
        
        return f"Content of {url}:\n\n{content}"
    except Exception as e:
        return f"Error browsing {url}: {e}"

def search_project(pattern: str) -> str:
    """Searches for a pattern in the project files."""
    results = []
    ignore_dirs = {".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode", "dist", "build"}
    import re
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error:
        # Fallback to literal search if regex is invalid
        regex = None

    for r, d, f in os.walk("."):
        # Prune ignored directories
        d[:] = [dirname for dirname in d if dirname not in ignore_dirs and not dirname.startswith(".")]
        
        for file in f:
            if file.startswith("."): continue
            file_path = os.path.join(r, file)
            try:
                # Simple binary check
                with open(file_path, 'rb') as bf:
                    if b'\x00' in bf.read(1024):
                        continue
                
                with open(file_path, 'r', encoding='utf-8', errors='replace') as tf:
                    for i, line in enumerate(tf, 1):
                        content = line.strip()
                        if regex:
                            if regex.search(content):
                                results.append(f"{file_path}:{i}: {content}")
                        elif pattern.lower() in content.lower():
                            results.append(f"{file_path}:{i}: {content}")
                
                if len(results) > 50:
                    return "\n".join(results[:50]) + "\n... (truncated)"
            except Exception:
                continue
    
    if not results:
        return f"No results found for '{pattern}'."
    return "\n".join(results)

def show_diff(file_path: str, original: str, edited: str):
    """Shows a side-by-side or unified diff using Rich, collapsing large ones."""
    p = Path(file_path)
    file_link = f"file:///{p.absolute().as_posix()}"
    title = f"Diff: [link={file_link}]{file_path}[/link]"
    
    if not original and edited:
        # New file
        lines = edited.splitlines()
        if len(lines) > 8:
            console.print(Panel(f"[bold red]BIGG DIF[/bold red] (New File)\n\n[dim]First line:[/dim]\n[yellow]{lines[0] if lines else ''}[/yellow]", title=f"[green]New File:[/green] [link={file_link}]{file_path}[/link]", border_style="green"))
        else:
            syntax = Syntax(edited, "python", theme="monokai", line_numbers=True)
            console.print(Panel(syntax, title=f"[green]New File:[/green] [link={file_link}]{file_path}[/link]", border_style="green"))
        return

    diff_lines = list(difflib.unified_diff(
        original.splitlines(),
        edited.splitlines(),
        fromfile=f"a/{file_path}",
        tofile=f"b/{file_path}",
        lineterm=""
    ))
    
    if not diff_lines:
        return

    # Count actual changes (lines starting with + or - but not headers)
    actual_changes = [l for l in diff_lines if l.startswith(('+', '-')) and not l.startswith(('+++', '---'))]
    
    # If more than 5 lines of changes or more than 15 lines of total diff (including context)
    if len(actual_changes) > 5 or len(diff_lines) > 15:
        first_change = actual_changes[0] if actual_changes else "..."
        console.print(Panel(f"[bold red]BIGG DIF[/bold red]\n\n[dim]First edit:[/dim]\n[yellow]{first_change}[/yellow]", title=title, border_style="yellow"))
    else:
        diff_text = "\n".join(diff_lines)
        syntax = Syntax(diff_text, "diff", theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=title, border_style="bright_blue"))
def extract_json(text: str) -> str:
    """Robustly extracts a JSON object from text by finding the first '{' and the last valid '}'."""
    start = text.find('{')
    if start == -1:
        return text
    
    # Iterate backwards from the end to find the correct closing brace that makes it valid JSON
    for i in range(len(text)-1, start, -1):
        if text[i] == '}':
            candidate = text[start:i+1]
            try:
                json.loads(candidate)
                return candidate
            except json.JSONDecodeError:
                continue
    
    # Fallback to simple slice if no valid JSON found by iteration
    return text[start:text.rfind('}')+1] if '}' in text else text[start:]

def handle(text: str, args, mission_data=None):
    if text.startswith("/"):
        if handle_command(text, args):
            return

    # Newline support
    if cfg.is_newline_support():
        text = text.replace("\\n", "\n")
    
    # Start tracking current debug item
    current_debug = {"user_input": text, "task": None, "response": None}
    DEBUG_HISTORY.append(current_debug)

    try:
        active_provider_name = cfg.get_active_provider()
        provider = get_provider(active_provider_name)
    except Exception as e:
        console.print(f"[red]Error initializing provider:[/red] {e}")
        return

    # Thinking phase with "Stop" (KeyboardInterrupt) support
    is_plan_only = args.plan or cfg.is_planning_mode()
    
    status_msg = "[bold green]Thinking...[/bold green]"
    if is_plan_only: status_msg = "[bold blue]Deeply Planning...[/bold blue]"
    if mission_data:
        if "error" in mission_data: status_msg = "[bold red]Recovering from Error...[/bold red]"
        elif "files" in mission_data: status_msg = "[bold cyan]Analyzing Requested Files...[/bold cyan]"
        elif "web_results" in mission_data: status_msg = "[bold yellow]Synthesizing Web Results...[/bold yellow]"
        elif "project_search" in mission_data: status_msg = "[bold magenta]Analyzing Project Search...[/bold magenta]"

    try:
        with console.status(f"{status_msg} [dim]using {active_provider_name}[/dim]", spinner="bouncingBar"):
            try:
                # Check if global planning mode is on
                is_fast = args.fast or cfg.is_fast_mode()
                task = build(text, is_plan_only, fast=is_fast, mission_data=mission_data)
                current_debug["task"] = task
                out = provider.call(PROMPT, task)
                current_debug["response"] = out

                cost = 0.0
                raw_model_thinking = ""
                if isinstance(out, tuple):
                    if len(out) == 3:
                        response_text, usage, raw_model_thinking = out
                    else:
                        response_text, usage = out
                        
                    try:
                        input_tokens = usage.get("input_tokens", 0)
                        output_tokens = usage.get("output_tokens", 0)
                        cost = from_cost.calculate_cost(active_provider_name, input_tokens, output_tokens)
                        
                        # Update global stats
                        SESSION_STATS["input_tokens"] += input_tokens
                        SESSION_STATS["output_tokens"] += output_tokens
                        SESSION_STATS["total_cost"] += cost
                        
                        console.print(f"[dim]Tokens: {input_tokens} -> {output_tokens} | Cost: ${cost:.4f}[/dim]")
                    except Exception:
                         pass
                else:
                    response_text = out
            except Exception as e:
                console.print(f"[red]Provider Error:[/red] {e}")
                return
    except KeyboardInterrupt:
        console.print("\n[bold red]Interrupted Thinking.[/bold red]")
        return

    # Robust JSON extraction
    extracted_text = extract_json(response_text)
    try:
        data = json.loads(extracted_text)
    except json.JSONDecodeError:
        if "```json" in response_text:
            try:
                inner_json = response_text.split("```json")[1].split("```")[0].strip()
                data = json.loads(extract_json(inner_json))
            except Exception as e:
                if cfg.is_mission_mode():
                    handle(text, args, mission_data={"error": f"Error parsing JSON: {e}"})
                    return
                console.print(f"[red]Failed to parse response:[/red] {e}")
                return
        else:
            if cfg.is_mission_mode():
                handle(text, args, mission_data={"error": "Response was not valid JSON."})
                return
            console.print(f"[red]Failed to parse response:[/red] {response_text}")
            return

    # Handle request_files
    requested_files = data.get("request_files", [])
    if requested_files and (cfg.is_mission_mode() or is_plan_only):
        if cfg.is_visibility_allowed():
            files_context = ""
            for rf in requested_files:
                p = Path(rf)
                if p.exists():
                    files_context += f"\n--- {rf} ---\n{p.read_text()}\n"
                else:
                    files_context += f"\n--- {rf} ---\nError: File not found.\n"
            console.print(f"[blue]Agent requested {len(requested_files)} files for context.[/blue]")
            handle(text, args, mission_data={"files": files_context})
            return
        else:
            handle(f"{text}\n\nError: Permission denied. You requested {requested_files} but full visibility is currently DISABLED. Ask the user to run `/visibility` to grant permission.", args)
            return

    # Handle web search and browse
    search_query = data.get("web_search")
    browse_url = data.get("web_browse")
    
    if (search_query or browse_url) and (cfg.is_mission_mode() or is_plan_only):
        if cfg.is_web_browsing_allowed():
            context_update = ""
            if search_query:
                console.print(f"[blue]Agent is searching for:[/blue] {search_query}")
                results = web_search(search_query)
                context_update += f"\nSearch Results for '{search_query}':\n{results}\n"
            
            if browse_url:
                console.print(f"[blue]Agent is browsing:[/blue] {browse_url}")
                content = web_browse(browse_url)
                context_update += f"\nContent of {browse_url}:\n{content}\n"
            
            handle(text, args, mission_data={"web_results": context_update})
            return
        else:
            handle(f"{text}\n\nError: Web browsing is currently DISABLED. Ask the user to run `/web` to enable it if you need search or browsing capabilities.", args)
            return

    # Handle search_project
    search_pattern = data.get("search_project")
    if search_pattern and (cfg.is_mission_mode() or is_plan_only):
        console.print(f"[blue]Agent is searching project for:[/blue] {search_pattern}")
        results = search_project(search_pattern)
        handle(text, args, mission_data={"project_search": results})
        return

    # Display Thought
    structured_thought = data.get("thought", "")
    response_msg = data.get("response")
    changes = data.get("changes", [])
    commands = data.get("commands", [])

    # Only show detailed thinking if NOT in a quiet mission step and NOT in fast mode
    show_ui = not mission_data or response_msg or changes or commands
    if is_fast and changes: show_ui = False

    if (raw_model_thinking or structured_thought) and show_ui:
        # Combine raw model thinking (e.g. from <think> tags) with structured agent reasoning
        combined_thinking = ""
        if raw_model_thinking:
            combined_thinking += f"#### Raw Model Thinking\n\n{raw_model_thinking}\n\n"
        if structured_thought:
            if raw_model_thinking: combined_thinking += "---\n\n"
            combined_thinking += f"#### Agent Strategy\n\n{structured_thought}"
            
        console.print(Panel(
            Markdown(combined_thinking),
            title="[bold cyan]Deep Reasoning[/bold cyan]",
            subtitle="[dim]Chain of Thought / Reasoning Content[/dim]",
            border_style="cyan",
            padding=(1, 1)
        ))

    # Display Response (Direct communication)
    if response_msg:
        console.print(Panel(Markdown(response_msg), title="Agent Response", border_style="bold green"))
        if cfg.is_voice_mode():
            speak_text(response_msg)

    # Display Plan
    if not (is_fast and (changes or commands)):
        console.print(Rule(style="blue"))
        plan_text = data.get("plan", "No plan provided")
        console.print(Panel(Markdown(plan_text), title="Technical Plan", border_style="cyan"))
    
    # Speak plan if voice mode is on and no response was provided
    if cfg.is_voice_mode() and not response_msg:
        speak_text(plan_text)
    
    if data.get("self_critique"):
         console.print(Panel(Markdown(data.get("self_critique")), title="Self Critique", border_style="yellow"))

    # Display proposed changes
    changes = data.get("changes", [])
    if changes:
        console.print("\n[bold]Proposed Changes:[/bold]")
        for c in changes:
            try:
                file_path = c['file']
                show_diff(file_path, c.get('original', ''), c.get('edited', ''))
            except Exception as e:
                console.print(f"[red]Error showing diff for {c['file']}:[/red] {e}")
        
        # Pause to let user review diffs
        if not (args.yes or cfg.is_fast_mode()):
            console.input("\n[dim]Press Enter to continue to options...[/dim]")
    else:
        console.print("[dim]No file changes proposed.[/dim]")

    # Display proposed commands
    commands = data.get("commands", [])
    if commands:
        from rich.table import Table
        ct = Table(title="Proposed Commands", border_style="yellow")
        ct.add_column("Command", style="bold green")
        ct.add_column("Reason", style="dim")
        for c in commands:
            ct.add_row(c['command'], c.get('reason', ''))
        console.print(ct)

    # Interaction Loop
    while True:
        if args.yes:
            console.print("[yellow]Auto-applying changes and commands (--yes)[/yellow]")
            user_input = "a"
        else:
            console.print(Rule(style="white"))
            user_input = console.input("[bold green]>[/bold green] (A)ccept / (R)eject / Type to refine: ").strip()
        
        if user_input.lower() in ("a", "accept", ""):
            # Commands execution
            if commands:
                policy = cfg.get_run_policy()
                if policy == "never":
                    console.print("[red]Command execution skipped (Run Policy: NEVER)[/red]")
                elif policy == "always" or args.yes or cfg.is_mission_mode():
                    for c in commands:
                        console.print(f"[bold blue]Running:[/bold blue] {c['command']}")
                        # Captured execution for missions
                        res = subprocess.run(c['command'], shell=True, capture_output=True, text=True)
                        output_msg = f"Command output:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}\nReturn Code: {res.returncode}"
                        
                        if cfg.is_mission_mode():
                             console.print(Panel(output_msg, title="Command Output", border_style="yellow"))
                             # Prepare next iteration
                             text = f"{text}\n\nCommand results for `{c['command']}`:\n{output_msg}"
                        else:
                             # Just show it if not in mission mode but always run is on
                             if res.stdout: console.print(f"[dim]{res.stdout}[/dim]")
                             if res.stderr: console.print(f"[red]{res.stderr}[/red]")
                else: # ask
                    for c in commands:
                        if console.input(f"Run [bold green]{c['command']}[/bold green]? (y/n): ").lower() == 'y':
                             subprocess.run(c['command'], shell=True)
            
            if not changes:
                if not commands:
                    console.print("[yellow]No changes or commands to apply.[/yellow]")
                break
                
            console.print(Rule(title="Applying Changes", style="green"))
            try:
                apply(changes)
                for c in changes:
                    p = Path(c["file"])
                    file_link = f"file:///{p.absolute().as_posix()}"
                    status = "[bold green]Created[/bold green]" if not c.get("original") else "[bold blue]Modified[/bold blue]"
                    console.print(f"{status}: [link={file_link}]{c['file']}[/link]")
            except Exception as e:
                error_msg = f"Error applying changes: {e}"
                console.print(f"[bold red]{error_msg}[/bold red]")
                if cfg.is_mission_mode():
                    console.print("[yellow]Retrying autonomously...[/yellow]")
                    handle(text, args, mission_data={"error": error_msg})
                    return
                break
            
            if not (args.fast or cfg.is_fast_mode()):
                console.input("\n[dim]Changes applied. Press Enter to return to prompt...[/dim]")

            # Record success
            add({
                "time": time.time(),
                "input": text,
                "plan": data.get("plan"),
                "confidence": data.get("confidence"),
                "changes": len(changes)
            })

            if args.fast or cfg.is_fast_mode():
                if not cfg.is_mission_mode():
                    console.print("[dim]Skipping review (Fast Mode)[/dim]")
                    break

            # Mission continuity
            if cfg.is_mission_mode():
                if "MISSION COMPLETE" in data.get("plan", "").upper():
                    console.print("[bold green]Mission Completed Successfully.[/bold green]")
                    cfg.set_mission_mode(False)
                    break
                else:
                    console.print("[bold yellow]Continuing Mission...[/bold yellow]")
                    handle(text, args) # Recursive call will preserve context through existing logic
                    return

            break
            
        elif user_input.lower() in ("r", "reject"):
            console.print("[red]Rejected.[/red]")
            return
            
        else:
            # Refinement
            console.print(f"[blue]Refining with instruction:[/blue] {user_input}")
            # Recursively call handle with updated instruction? 
            # Better: Append to current task context. For now, simple recursion with composite prompt.
            # In a real agent, we'd append to chat history. 
            # Here we cheat slightly by modifying the query.
            text = f"{text}\n\nUser Feedback: {user_input}"
            handle(text, args) 
            return

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="Only generate a plan, do not apply changes")
    ap.add_argument("--no-apply", action="store_true", help="Do not apply changes")
    ap.add_argument("--verbose", action="store_true", help="Show verbose output")
    ap.add_argument("--yes", "-y", action="store_true", help="Auto-apply changes (skip confirmation)")
    ap.add_argument("--fast", action="store_true", help="Fast mode (skip post-apply review)")
    args = ap.parse_args()

    from rich.table import Table

    # Clean launch
    console.clear()

    from memory import get_active_session_name
    active_session = get_active_session_name()

    # Banner
    console.print(Panel(
        f"[bold white]Agent CLI[/bold white] [dim]v1.2[/dim] | [dim]Provider:[/dim] [bold green]{cfg.get_active_provider()}[/bold green] | [dim]Session:[/dim] [bold cyan]{active_session}[/bold cyan]\n"
        "[dim]Support:[/dim] [bold blue]Voice, Newlines, History, Debug[/bold blue]\n",
        border_style="bright_black",
        padding=(0, 1),
        title="[bold cyan]Ready[/bold cyan]",
        title_align="left"
    ))
    
    # Session restoration
    if cfg.is_auto_reload_enabled():
        from memory import restore
        if restore():
            console.print("[dim]Restored previous session snapshot.[/dim]")

    loop(lambda t: handle(t, args))

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n[dim]Goodbye![/dim]")
        sys.exit(0)
