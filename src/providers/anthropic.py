
import json
import os
from typing import Dict, Any, Tuple, Optional
from providers.base import Provider
from config import cfg

try:
    import anthropic
except ImportError:
    anthropic = None

class AnthropicProvider(Provider):
    def call(self, system: str, task: Dict[str, Any]) -> Tuple[str, Dict[str, Any], str]:
        if anthropic is None:
            raise ImportError("Anthropic package is not installed. Please install it with 'pip install anthropic'")
            
        api_key = cfg.get_api_key("anthropic")
        if not api_key:
            raise ValueError("Anthropic API key not found. Please set it using '/config anthropic_api_key <key>'")
            
        client = anthropic.Anthropic(api_key=api_key, timeout=None)
        config = cfg.get_provider_config("anthropic")
        
        try:
            gen_config = config.get("generation", {})
            response = client.messages.create(
                model=config.get("model", "claude-3-5-sonnet-20241022"),
                max_tokens=gen_config.get("max_tokens", 4096),
                system=system,
                messages=[
                    {"role": "user", "content": json.dumps(task)}
                ]
            )
            usage = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens
            }
            return response.content[0].text, usage, ""
        except Exception as e:
            print(f"Error calling Anthropic: {e}")
            raise

    def validate(self) -> Tuple[bool, str]:
        if anthropic is None:
            return False, "Anthropic package is not installed."
        api_key = cfg.get_api_key("anthropic")
        if not api_key:
            return False, "Anthropic API key not set."
        client = anthropic.Anthropic(api_key=api_key)
        try:
            client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}]
            )
            return True, "Anthropic API key is valid."
        except Exception as e:
            return False, f"Anthropic validation failed: {str(e)}"
