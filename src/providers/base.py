
from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple, Optional

class Provider(ABC):
    @abstractmethod
    def call(self, system: str, task: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Optional[str]]:
        """
        Sends a request to the LLM provider.
        
        Args:
            system: The system prompt.
            task: The task dictionary (user input, context, etc.).
            
        Returns:
            A tuple containing:
            - The raw JSON string response from the LLM.
            - A dictionary with usage metadata (e.g., {"input_tokens": 100, "output_tokens": 50}).
            - Optional thinking string (e.g. for chain-of-thought models).
        """
    @abstractmethod
    def validate(self) -> Tuple[bool, str]:
        """
        Validates the current configuration (API key or endpoint).
        
        Returns:
            A tuple containing (is_valid, error_message).
        """
        pass
