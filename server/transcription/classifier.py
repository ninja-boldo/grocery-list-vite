from typing import List, Union, Dict, Literal, Any
from pydantic import BaseModel, Field, ValidationError
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
import os
import json
import re

# Confidence threshold - if either classification falls below this, return unknown
CONFIDENCE_THRESHOLD = 0.5

# Model configuration
GROQ_MODEL = "openai/gpt-oss-20b"  # OpenAI's open-weight 20B model on Groq

def _get_llm():
    """Get the ChatGroq LLM instance."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY environment variable is not set")
    return ChatGroq(
        model=GROQ_MODEL,
        temperature=0.1,  # Low temperature for consistent classification
        api_key=api_key,
    )

def _extract_json(text: str) -> dict:
    """Extract JSON object from text, handling various formats."""
    # Try to find JSON in the text
    text = text.strip()
    
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # Try to find JSON object in the text
    json_match = re.search(r'\{[^{}]*\}', text)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
    
    return {}

class Classification(BaseModel):
    category: str  # runtime-validated against injected classes
    confidence: float = Field(ge=0.0, le=1.0)

class ActionClassification(BaseModel):
    action: Literal["add", "remove", "unknown"]
    confidence: float = Field(ge=0.0, le=1.0)

class FullClassification(BaseModel):
    category: str
    category_confidence: float = Field(ge=0.0, le=1.0)
    action: Literal["add", "remove", "unknown"]
    action_confidence: float = Field(ge=0.0, le=1.0)

PROMPT_TMPL = """
Find the item in the text: "{input}"

Options: {classes}

Return EXACTLY one JSON object and nothing else, e.g.:
{{"category":"milch","confidence":0.95}}

- "category" must be one of the options above. If none match, return "unknown".
- "confidence" must be a float between 0.0 and 1.0.
"""

ACTION_PROMPT_TMPL = """
Determine the intent from this text: "{input}"

The user is either:
- ADDING/INCREMENTING an item (wants to buy it, add to list, get more, etc.)
- REMOVING/DECREMENTING an item (already bought it, remove from list, got it, checked off, etc.)

Return EXACTLY one JSON object and nothing else, e.g.:
{{"action":"add","confidence":0.95}}

- "action" must be either "add" or "remove". If unclear, return "unknown".
- "confidence" must be a float between 0.0 and 1.0.

Common patterns:
- "add X", "I need X", "buy X", "get X", "put X on list" → add
- "got X", "bought X", "remove X", "checked off X", "have X" → remove
"""

def _normalize_classes(classes: Union[str, List[str]]) -> List[str]:
    if isinstance(classes, str):
        cls = [c.strip() for c in classes.split(",") if c.strip()]
    else:
        cls = [str(c).strip() for c in classes if str(c).strip()]
    if "unknown" not in cls:
        cls.append("unknown")
    return cls

def _classify_category(input_text: str, classes_list: List[str]) -> Dict[str, Any]:
    """Classify the item category from the input text."""
    llm = _get_llm()
    classes_str = ", ".join(classes_list)
    
    prompt = ChatPromptTemplate.from_template(PROMPT_TMPL)
    chain = prompt | llm

    try:
        result = chain.invoke({"input": input_text, "classes": classes_str})
        
        # Extract the text content from the response
        text_content = result.content if hasattr(result, 'content') else str(result)
        out = _extract_json(text_content)
    except Exception as e:
        print(f"Error during category classification: {e}")
        return {"category": "unknown", "confidence": 0.0}

    cat = out.get("category", "unknown")
    try:
        conf = float(out.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0

    # Case-insensitive matching - find the original case from classes_list
    cat_lower = str(cat).lower()
    classes_lower_map = {c.lower(): c for c in classes_list}
    if cat_lower in classes_lower_map:
        cat = classes_lower_map[cat_lower]
    else:
        cat = "unknown"
        conf = min(conf, 0.2)

    conf = max(0.0, min(1.0, conf))

    try:
        validated = Classification(category=cat, confidence=conf)
    except ValidationError:
        validated = Classification(category="unknown", confidence=0.0)

    if validated.category not in classes_list:
        return {"category": "unknown", "confidence": 0.0}
    return {"category": validated.category, "confidence": validated.confidence}

def _classify_action(input_text: str) -> Dict[str, Any]:
    """Classify whether the user wants to add or remove an item."""
    llm = _get_llm()
    prompt = ChatPromptTemplate.from_template(ACTION_PROMPT_TMPL)
    chain = prompt | llm

    try:
        result = chain.invoke({"input": input_text})
        
        # Extract the text content from the response
        text_content = result.content if hasattr(result, 'content') else str(result)
        out = _extract_json(text_content)
    except Exception as e:
        print(f"Error during action classification: {e}")
        return {"action": "unknown", "confidence": 0.0}

    action = out.get("action", "unknown")
    try:
        conf = float(out.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0

    if action not in ["add", "remove"]:
        action = "unknown"
        conf = min(conf, 0.2)

    conf = max(0.0, min(1.0, conf))

    try:
        validated = ActionClassification(action=action, confidence=conf)
    except ValidationError:
        validated = ActionClassification(action="unknown", confidence=0.0)

    return {"action": validated.action, "confidence": validated.confidence}

def classify(
    input_text: str, 
    classes: Union[str, List[str]], 
    threshold: float = CONFIDENCE_THRESHOLD
) -> Dict[str, Any]:
    """
    Classify both the item category and the action (add/remove) from input text.
    
    Returns a dict with:
        - category: the identified item or "unknown"
        - category_confidence: confidence for the category
        - action: "add", "remove", or "unknown"
        - action_confidence: confidence for the action
    
    If either confidence falls below the threshold, both are set to "unknown".
    """
    classes_list = _normalize_classes(classes)

    # Classify both category and action
    category_result = _classify_category(input_text, classes_list)
    action_result = _classify_action(input_text)

    cat: str = category_result["category"]
    cat_conf: float = category_result["confidence"]
    action: str = action_result["action"]
    action_conf: float = action_result["confidence"]

    # If either confidence is below threshold, return unknown for both
    if cat_conf < threshold or action_conf < threshold:
        return {
            "category": "unknown",
            "category_confidence": cat_conf,
            "action": "unknown", 
            "action_confidence": action_conf
        }

    return {
        "category": cat,
        "category_confidence": cat_conf,
        "action": action,
        "action_confidence": action_conf
    }


# Backwards-compatible wrapper for existing code that only expects category
def classify_category_only(
    input_text: str, 
    classes: Union[str, List[str]]
) -> Dict[str, Any]:
    """
    Legacy function - only returns category classification.
    Use classify() for full category + action classification.
    """
    classes_list = _normalize_classes(classes)
    return _classify_category(input_text, classes_list)
