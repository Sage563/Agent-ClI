
import json
import requests
from providers.base import Provider
from config import cfg
from typing import Dict, Any, Tuple, Optional

class OllamaProvider(Provider):
    def call(self, system: str, task: Dict[str, Any]) -> Tuple[str, Dict[str, Any], str]:
        config = cfg.get_provider_config("ollama")
        url = config["endpoint"].rstrip("/") + "/api/chat"
        generation = config.get("generation", {}).copy()
        
        # Map tokens to num_predict for Ollama
        if "max_tokens" in generation:
            generation["num_predict"] = generation.pop("max_tokens")
        elif "max_output_tokens" in generation: # Gemini compatibility
            generation["num_predict"] = generation.pop("max_output_tokens")

        payload = {
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(task)}
            ],
            "stream": False,
            "options": generation
        }
        
        try:
            r = requests.post(url, json=payload, timeout=None)
            if r.status_code == 404:
                raise requests.exceptions.RequestException(
                    f"Model '{config['model']}' not found. "
                    f"Please run 'ollama pull {config['model']}' on your server ({config['endpoint']})."
                )
            r.raise_for_status()
            data = r.json()
            full_content = data["message"]["content"]
            
            # Extract thinking content if present (e.g. DeepSeek R1)
            thinking = ""
            if "<think>" in full_content and "</think>" in full_content:
                parts = full_content.split("</think>")
                thinking = parts[0].replace("<think>", "").strip()
                content = parts[1].strip()
            else:
                content = full_content
                
            usage = {
                "input_tokens": data.get("prompt_eval_count", 0),
                "output_tokens": data.get("eval_count", 0)
            }
            return (content, usage, thinking)
        except requests.exceptions.RequestException as e:
            print(f"Error calling Ollama (Qwen): {e}")
            raise

    def validate(self) -> Tuple[bool, str]:
        config = cfg.get_provider_config("ollama")
        endpoint = config.get("endpoint", "http://localhost:11434").rstrip("/")
        url = f"{endpoint}/api/tags"
        try:
            r = requests.get(url, timeout=5)
            r.raise_for_status()
            return True, "Ollama (Qwen) endpoint is reachable."
        except requests.exceptions.RequestException as e:
            return False, f"Ollama (Qwen) not reachable: {str(e)}"
