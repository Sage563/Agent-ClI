
import json
import os
from typing import Dict, Any, Tuple, Optional
from providers.base import Provider
from config import cfg

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

class OpenAIProvider(Provider):
    def call(self, system: str, task: Dict[str, Any]) -> Tuple[str, Dict[str, Any], str]:
        if OpenAI is None:
            raise ImportError("OpenAI package is not installed. Please install it with 'pip install openai'")
            
        api_key = cfg.get_api_key("openai")
        if not api_key:
            raise ValueError("OpenAI API key not found. Please set it using '/config openai_api_key <key>'")
            
        client = OpenAI(api_key=api_key, timeout=None)
        config = cfg.get_provider_config("openai")
        
        try:
            response = client.chat.completions.create(
                model=config.get("model", "gpt-4o"),
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(task)}
                ],
                **config.get("generation", {})
            )
            usage = {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens
            }
            msg = response.choices[0].message
            reasoning = getattr(msg, "reasoning_content", "") or ""
            return msg.content, usage, reasoning
        except Exception as e:
            print(f"Error calling OpenAI: {e}")
            raise

    def validate(self) -> Tuple[bool, str]:
        if OpenAI is None:
            return False, "OpenAI package is not installed."
        api_key = cfg.get_api_key("openai")
        if not api_key:
            return False, "OpenAI API key not set."
            
        client = OpenAI(api_key=api_key)
        try:
            # A simple call to list models to verify the key
            client.models.list()
            return True, "OpenAI API key is valid."
        except Exception as e:
            return False, f"OpenAI validation failed: {str(e)}"
