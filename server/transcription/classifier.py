from typing import List, Union, Dict
from pydantic import BaseModel, Field, ValidationError
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama

llm = ChatOllama(model="qwen3:1.7b")

class Classification(BaseModel):
    category: str  # runtime-validated against injected classes
    confidence: float = Field(ge=0.0, le=1.0)

PROMPT_TMPL = """
Find the item in the text: "{input}"

Options: {classes}

Return EXACTLY one JSON object and nothing else, e.g.:
{{"category":"milch","confidence":0.95}}

- "category" must be one of the options above. If none match, return "unknown".
- "confidence" must be a float between 0.0 and 1.0.
"""

def _normalize_classes(classes: Union[str, List[str]]) -> List[str]:
    if isinstance(classes, str):
        cls = [c.strip() for c in classes.split(",") if c.strip()]
    else:
        cls = [str(c).strip() for c in classes if str(c).strip()]
    if "unknown" not in cls:
        cls.append("unknown")
    return cls

def classify(input_text: str, classes: Union[str, List[str]]) -> Dict[str, Union[str, float]]:
    classes_list = _normalize_classes(classes)
    classes_str = ", ".join(classes_list)

    prompt = ChatPromptTemplate.from_template(PROMPT_TMPL)
    structured_llm = llm.with_structured_output(Classification)
    chain = prompt | structured_llm

    # If your client is async, replace with: result = await chain.invoke({...})
    result = chain.invoke({"input": input_text, "classes": classes_str})
    out = result.model_dump()

    # Defensive parsing/validation
    cat = out.get("category")
    try:
        conf = float(out.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0

    if cat not in classes_list:
        cat = "unknown"
        conf = min(conf, 0.2)

    conf = max(0.0, min(1.0, conf))

    # Final validation through pydantic to ensure types/limits
    try:
        validated = Classification(category=cat, confidence=conf)
    except ValidationError:
        # fallback safe value
        validated = Classification(category="unknown", confidence=0.0)

    # Guarantee category is one of the injected set (or "unknown")
    if validated.category not in classes_list:
        return {"category": "unknown", "confidence": 0.0}
    return {"category": validated.category, "confidence": validated.confidence}
