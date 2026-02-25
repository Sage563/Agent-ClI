
import json
from pathlib import Path
from typing import Dict, Any, Optional

CONFIG_FILE = Path("agent.config.json")
SECRETS_FILE = Path(".secrets.json")

class Config:
    def __init__(self):
        self.config = self._load_json(CONFIG_FILE)
        self.secrets = self._load_json(SECRETS_FILE)
        
        # Ensure default structure
        if "active_provider" not in self.config:
            self.config["active_provider"] = "ollama"
        if "providers" not in self.config:
            self.config["providers"] = {}
            # Migrate existing config if present
            if "provider" in self.config and self.config["provider"] == "ollama":
                self.config["providers"]["ollama"] = {
                    "endpoint": self.config.get("endpoint"),
                    "model": self.config.get("model"),
                    "generation": self.config.get("generation", {})
                }
        
        # New defaults
        if "voice_mode" not in self.config:
            self.config["voice_mode"] = False
        if "newline_support" not in self.config:
            self.config["newline_support"] = True
        if "mission_mode" not in self.config:
            self.config["mission_mode"] = False
        if "visibility_allowed" not in self.config:
            self.config["visibility_allowed"] = False
        if "auto_reload_session" not in self.config:
            self.config["auto_reload_session"] = False
        if "web_browsing_allowed" not in self.config:
            self.config["web_browsing_allowed"] = False

    def _load_json(self, path: Path) -> Dict[str, Any]:
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return {}

    def save(self):
        CONFIG_FILE.write_text(json.dumps(self.config, indent=2))
        SECRETS_FILE.write_text(json.dumps(self.secrets, indent=2))

    def get_provider_config(self, provider_name: str) -> Dict[str, Any]:
        return self.config.get("providers", {}).get(provider_name, {})

    def get_active_provider(self) -> str:
        return self.config.get("active_provider", "ollama")

    def set_active_provider(self, provider_name: str):
        self.config["active_provider"] = provider_name
        self.save()

    def get_api_key(self, provider_name: str) -> Optional[str]:
        return self.secrets.get(f"{provider_name}_api_key")

    def set_api_key(self, provider_name: str, key: str):
        self.secrets[f"{provider_name}_api_key"] = key
        self.save()

    def set_ollama_endpoint(self, url: str):
        if "ollama" not in self.config["providers"]:
            self.config["providers"]["ollama"] = {}
        self.config["providers"]["ollama"]["endpoint"] = url
        self.save()

    def is_planning_mode(self) -> bool:
        return self.config.get("planning_mode", False)

    def set_planning_mode(self, enabled: bool):
        self.config["planning_mode"] = enabled
        self.save()

    def is_fast_mode(self) -> bool:
        return self.config.get("fast_mode", False)

    def set_fast_mode(self, enabled: bool):
        self.config["fast_mode"] = enabled
        self.save()

    def get_run_policy(self) -> str:
        return self.config.get("run_policy", "ask")

    def set_run_policy(self, policy: str):
        if policy in ("ask", "always", "never"):
            self.config["run_policy"] = policy
            self.save()

    def is_voice_mode(self) -> bool:
        return self.config.get("voice_mode", False)

    def set_voice_mode(self, enabled: bool):
        self.config["voice_mode"] = enabled
        self.save()

    def is_newline_support(self) -> bool:
        return self.config.get("newline_support", False)

    def set_newline_support(self, enabled: bool):
        self.config["newline_support"] = enabled
        self.save()

    def is_mission_mode(self) -> bool:
        return self.config.get("mission_mode", False)

    def set_mission_mode(self, enabled: bool):
        self.config["mission_mode"] = enabled
        self.save()

    def is_visibility_allowed(self) -> bool:
        return self.config.get("visibility_allowed", False)

    def set_visibility_allowed(self, enabled: bool):
        self.config["visibility_allowed"] = enabled
        self.save()

    def is_auto_reload_enabled(self) -> bool:
        return self.config.get("auto_reload_session", False)

    def set_auto_reload(self, enabled: bool):
        self.config["auto_reload_session"] = enabled
        self.save()

    def is_web_browsing_allowed(self) -> bool:
        return self.config.get("web_browsing_allowed", False)

    def set_web_browsing_allowed(self, enabled: bool):
        self.config["web_browsing_allowed"] = enabled
        self.save()

    def set_generation_param(self, provider_name: str, key: str, value: Any):
        if "providers" not in self.config:
            self.config["providers"] = {}
        if provider_name not in self.config["providers"]:
            self.config["providers"][provider_name] = {}
        if "generation" not in self.config["providers"][provider_name]:
            self.config["providers"][provider_name]["generation"] = {}
        
        if value is None:
            if key in self.config["providers"][provider_name]["generation"]:
                del self.config["providers"][provider_name]["generation"][key]
        else:
            self.config["providers"][provider_name]["generation"][key] = value
        self.save()

# Global instance
cfg = Config()
