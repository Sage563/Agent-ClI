
import json
import os
from typing import Dict, Any, Tuple, Optional
from providers.base import Provider
from config import cfg

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None

class GeminiProvider(Provider):
    def call(self, system: str, task: Dict[str, Any]) -> Tuple[str, Dict[str, Any], str]:
        if genai is None:
            raise ImportError("genai package is not installed. Please install it with 'pip install google-genai'")
            
        api_key = cfg.get_api_key("gemini")
        if not api_key:
            raise ValueError("Gemini API key not found. Please set it using '/config gemini_api_key <key>'")
            
        config = cfg.get_provider_config("gemini")
        client = genai.Client(api_key=api_key)
        
        model_name = config.get("model", "gemini-2.0-flash")
        generation_config = config.get("generation", {})
        
        # Ensure timeout is handled if needed, though genai defaults are usually fine
        # For unlimited timeout as per previous request:
        config_params = {
            "system_instruction": system,
            **generation_config
        }

        try:
            response = client.models.generate_content(
                model=model_name,
                contents=json.dumps(task),
                config=types.GenerateContentConfig(**config_params)
            )
            
            usage = {
                "input_tokens": response.usage_metadata.prompt_token_count or 0,
                "output_tokens": response.usage_metadata.candidates_token_count or 0
            }
            return response.text, usage, ""
        except Exception as e:
            print(f"Error calling Gemini: {e}")
            raise

    def validate(self) -> Tuple[bool, str]:
        if genai is None:
            return False, "genai package is not installed."
        api_key = cfg.get_api_key("gemini")
        if not api_key:
            return False, "Gemini API key not set."
        try:
            client = genai.Client(api_key=api_key)
            # Simple metadata call to verify key
            client.models.get(model='gemini-2.0-flash')
            return True, "Gemini API key is valid."
        except Exception as e:
            return False, f"Gemini validation failed: {str(e)}"
