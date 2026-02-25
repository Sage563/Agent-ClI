
from typing import Dict, Tuple

# Pricing per million tokens (approximate)
# Format: (input_price, output_price)
PRICING = {
    # OpenAI
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    # Anthropic
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "claude-3-opus-20240229": (15.00, 75.00),
    "claude-3-haiku-20240307": (0.25, 1.25),
    # Gemini
    "gemini-1.5-pro": (3.50, 10.50),
    "gemini-1.5-flash": (0.075, 0.30),
    # DeepSeek
    "deepseek": (0.14, 0.28),
    # Ollama (Local)
    "ollama": (0.0, 0.0),
}

def calculate_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    """
    Calculates the estimated cost for a given request.
    
    Args:
        model_name: The name of the model used.
        input_tokens: Number of input tokens.
        output_tokens: Number of output tokens.
        
    Returns:
        float: Estimated cost in USD.
    """
    # Normalize model name for matching
    key = next((k for k in PRICING if k in model_name), None)
    
    if not key:
        return 0.0
        
    input_price, output_price = PRICING[key]
    
    cost = (input_tokens / 1_000_000 * input_price) + (output_tokens / 1_000_000 * output_price)
    return cost
