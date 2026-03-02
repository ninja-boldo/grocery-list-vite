from typing import List, Union, Dict, Literal, Any
from peft import PeftModel
from pydantic import BaseModel, Field, ValidationError
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
import os
import json
import re
import ast

CONFIDENCE_THRESHOLD = 0.5

# Model configuration
GROQ_MODEL = "openai/gpt-oss-20b"  


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


def extract_batch_json(text: str) -> dict[str, str]:
    text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Replace single quotes with double quotes
    try:
        return json.loads(text.replace("'", '"'))
    except json.JSONDecodeError:
        pass

    # Regex fallback: extract outermost JSON object
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        candidate = m.group()
        candidate = re.sub(r",\s*}", "}", candidate)
        candidate = re.sub(r",\s*]", "]", candidate)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # Ultimate fallback
    return {}


def parse_category_list(category_str: str) -> List[str]:
    """
    Parse category string which can be either:
    - Empty string
    - Python list string like "['en:snacks', 'en:candies']"
    - Comma-separated string

    Returns a clean list of category strings.
    """
    if not category_str or category_str.strip() == "":
        return []

    category_str = category_str.strip()

    # Try to parse as Python list literal
    if category_str.startswith("[") and category_str.endswith("]"):
        try:
            parsed = ast.literal_eval(category_str)
            if isinstance(parsed, list):
                # Clean up 'en:' prefixes and extract main category
                cleaned = []
                for cat in parsed:
                    cat_str = str(cat).strip()
                    # Remove 'en:' prefix if present
                    if cat_str.startswith("en:"):
                        cat_str = cat_str[3:]
                    # Replace hyphens with spaces for readability
                    cat_str = cat_str.replace("-", " ")
                    cleaned.append(cat_str)
                return cleaned
        except (ValueError, SyntaxError):
            pass

    # Fallback: treat as comma-separated
    return [c.strip() for c in category_str.split(",") if c.strip()]


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

# --- NORMALIZATION TEMPLATES ---


TAG_TO_SHORTNAME_BATCH_PROMPT = """
You are a grocery product name generator.
For EACH base category tag, generate a natural short name.
this short name should be in this language(the lang code is provided like en or de): {languageCode}

INPUT FORMAT: {tag_combinations}

RULES:
1. Use the category name itself as the base.
2. Keep it minimal - 1 word, lowercase, no articles.

OUTPUT FORMAT:
Return EXACTLY one JSON object.
Key: ORIGINAL tag combination "base, flavor, form".
Value: Generated short name.

Example:
{{
  "dairy, none, none": "dairy",
  "sweet snack, none, none": "snack"
}}
"""

SHORTEN_BATCH_TMPL = """
You are a product name normalizer. Shorten and normalize product names into a concise, recognizable format.

RULES:
1. AGGRESSIVELY REMOVE MARKETING: French Jam, ohne Stücke, weniger Zucker, Classic, Bio, Extra, Stark, Natur, measurements (13oz, 370g), etc.
2. FOR JAMS/MARMALADES/SPREADS:
   - Always keep [Flavor] + [Product Type]. 
   - Use language-appropriate terms: Marmelade/Konfitüre (DE), Jam (EN), Confiture (FR), Mark (DE).
   - Example: "Samt Aprikose ohne Stücke weniger Zucker" → "Aprikosen Marmelade"
3. FOR BRANDED SNACKS: Keep brand + distinctive variant: "Chipsfrisch Ungarisch", "Haribo Wummis".
4. FOR NON-BRANDED: Keep descriptive product type + flavor: "Menthol Bonbons", "Couscous", "Earl Grey".
5. CLEANUP: Correct "Coucous" to "Couscous". Remove all parenthetical info.
6. NEVER TRANSLATE: Keep the original language of the product type.

INPUT DATA:
Items: {items_list}
Categories: {category_list}

OUTPUT FORMAT: Return EXACTLY one JSON object. No extra text.
{{"original_item_name": "shortened_name"}}
"""

SHORTEN_TMPL = """
Shorten and normalize product name: "{input}"
Categories: "{categories}"

RULES:
1. AGGRESSIVELY REMOVE: Bio, Extra, Stark, Natives, Natur, Ohne Zucker, weniger Zucker, measurements, etc.
2. JAMS/SPREADS: Remove brand names, keep flavor + product type (Marmelade, Jam, Mark).
3. BRANDED: Keep brand + variant if distinctive.
4. Correct spelling: Coucous → Couscous.
5. NEVER TRANSLATE - maintain input language.

Return EXACTLY one JSON object:
{{"shortenedText":"result here"}}
"""

# --- INTENT & SEARCH TEMPLATES ---

PROMPT_TMPL = """
Find the item in the text: "{input}"

Options: {classes}

Return EXACTLY one JSON object and nothing else, e.g.:
{{"category":"milk","confidence":0.95}}

- "category" must be one of the options above. If none match, return "unknown".
- "confidence" must be a float between 0.0 and 1.0.
"""

ACTION_PROMPT_TMPL = """
Determine the intent from this text: "{input}"

The user is either:
- ADDING/INCREMENTING an item (wants to buy it, add to list, etc.)
- REMOVING/DECREMENTING an item (bought it, remove from list, checked off, etc.)

Return EXACTLY one JSON object and nothing else, e.g.:
{{"action":"add","confidence":0.95}}

- "action" must be "add", "remove", or "unknown".
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


def _classify_category(input_text: str, classes_list: List[str]) -> Dict[str, Any]:
    """Classify the item category from the input text."""
    llm = _get_llm()
    classes_str = ", ".join(classes_list)

    prompt = ChatPromptTemplate.from_template(PROMPT_TMPL)
    chain = prompt | llm

    try:
        result = chain.invoke({"input": input_text, "classes": classes_str})

        # Extract the text content from the response
        text_content = result.content if hasattr(result, "content") else str(result)
        out = extract_batch_json(text_content)
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
        text_content = result.content if hasattr(result, "content") else str(result)
        out = extract_batch_json(text_content)
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
    threshold: float = CONFIDENCE_THRESHOLD,
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
            "action_confidence": action_conf,
        }

    return {
        "category": cat,
        "category_confidence": cat_conf,
        "action": action,
        "action_confidence": action_conf,
    }


def shortenText(inputText: str, categories: str | list[str]) -> str:
    if isinstance(categories, list):
        categories = ",".join(categories)[1:]  # remove trailing comma
    categories = categories.strip()

    llm = _get_llm()

    prompt = ChatPromptTemplate.from_template(SHORTEN_TMPL)
    chain = prompt | llm

    try:
        result = chain.invoke({"input": inputText, "categories": categories})

        # Extract the text content from the response
        text_content: str = (
            result.content if hasattr(result, "content") else str(result)
        )  # type: ignore
        out = extract_batch_json(text_content)
    except Exception as e:
        print(f"Error during category classification: {e}")
        return inputText.strip()

    return out.get("shortenedText", inputText.strip())


def shortenTextBatch(
    inputItems: list[str], categories: list[str] = []
) -> dict[str, str] | None:
    for idx, category in enumerate(categories):
        categories[idx] = category.strip()

    llm = _get_llm()

    prompt = ChatPromptTemplate.from_template(SHORTEN_BATCH_TMPL)
    chain = prompt | llm

    try:
        result = chain.invoke({"items_list": inputItems, "category_list": categories})

        # Extract the text content from the response
        text_content: str = (
            result.content if hasattr(result, "content") else str(result)
        )  # type: ignore
        out = extract_batch_json(text_content)
    except Exception as e:
        print(f"Error during category classification: {e}")
        return None

    resp = {item: out.get(item, item) for item in inputItems}
    print(
        f"got this input items: {inputItems}, these categories: {categories} and produced this output: {resp}"
    )

    return resp


def _validate_tag(tag: str, allowed_tags: List[str]) -> str:
    """Validate tag against allowed list, case-insensitive."""
    tag = str(tag).lower().strip()
    allowed_lower = {t.lower(): t for t in allowed_tags}
    return allowed_lower.get(tag, "unknown" if "unknown" in allowed_lower else "none")


class GroceryClassifier:
    def __init__(self):
        base_model = "NousResearch/Llama-3.2-1B"
        adapter_path = "./outputs/lora-out"
        
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
        )
        
        tokenizer = AutoTokenizer.from_pretrained(adapter_path)
        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            quantization_config=bnb_config,
            device_map="auto",
        )
        model.resize_token_embeddings(len(tokenizer))
        self.model = PeftModel.from_pretrained(model, adapter_path).eval()
        self.tagging_classes = [
            "meat_fish",
            "fruit_veg",
            "bread_bakery",
            "grains_pasta",
            "pantry_staples",
            "spices_seasoning",
            "snacks",
            "drinks",
            "frozen",
            "household",
            "canned_jars",
            "dairy_eggs",
        ]
        self.INSTRUCTION = (
            f"extract this into one of these categories{tuple(self.tagging_classes)}"
        )
        self.tokenizer = tokenizer

    def classify(self, item: str) -> str:
        prompt = f"### Instruction:\n{self.INSTRUCTION}\n\n### Input:\n{item}\n\n### Response:\n"
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            outputs = self.model.generate(**inputs, max_new_tokens=20, do_sample=False)
        result = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        return result.split("### Response:")[-1].strip()


async def tagAssignmentBatch(
    items: list[dict[str, str]],
) -> Dict[str, Dict[str, str]]:
    """
    Assign semantic tags to multiple grocery items in batch.

    Args:
        items: dict with keys: item_name, shortened_name, categories
        base_tags: Allowed base product tags (e.g., ["vinegar", "chips", "candy"])
        flavor_tags: Allowed flavor tags (e.g., ["apple", "menthol", "paprika", "none"])
        form_tags: Allowed form tags (e.g., ["liquid", "solid", "powder", "none"])
        batch_size: Number of items to process per API call (default: 50)

    Returns:
        Dict mapping item_name to { "base": str, "flavor": str, "form": str }
    """

    item_names, shortened_names, categories = [], [], []

    print(f"started tag assignment with this input: {items}")
    for item in items:
        item_names.append(item["item_name"])
        shortened_names.append(item["shortened_name"])
        categories.append(item["categories"])

    if not (len(item_names) == len(shortened_names) == len(categories)):
        raise ValueError(
            f"Input lists must have same length. Got: "
            f"item_names={len(item_names)}, "
            f"shortened_names={len(shortened_names)}, "
            f"categories={len(categories)}"
        )

    # Parse category strings into clean lists
    parsed_categories = []
    for cat_str in categories:
        parsed = parse_category_list(cat_str)
        # Join back to comma-separated for the prompt
        parsed_categories.append(", ".join(parsed) if parsed else "")

    classifier = GroceryClassifier()
    all_results = {}
    for item in item_names:
        all_results[item] = {
            "base": classifier.classify(item),
            "flavor": "none",
            "form": "none",
        }

    print(
        f"Processed {len(item_names)} and tagged them with {len(classifier.tagging_classes)} "
    )

    return all_results


def tagToNameBatch(tagsList: list[str], languageCode: str = "de"):
    print(f"started the tag to name batching with this input: {tagsList}")
    llm = _get_llm()

    # normalize input to match prompt

    tag_combinations = []
    for tag in tagsList:
        if tag.find("none,") == -1:
            tag_combinations.append((f"{tag}, none, none"))
        else:
            tag_combinations.append(tag)

    prompt = ChatPromptTemplate.from_template(TAG_TO_SHORTNAME_BATCH_PROMPT)
    chain = prompt | llm

    try:
        result = chain.invoke(
            {"tag_combinations": tag_combinations, "languageCode": languageCode}
        )

        # Extract the text content from the response
        text_content: str = (
            result.content if hasattr(result, "content") else str(result)
        )  # type: ignore
        out = extract_batch_json(text_content)
    except Exception as e:
        print(f"Error during category classification: {e}")
        return None

    # map back to original tag names
    resp = {tag: out.get(f"{tag}, none, none", "failed") for tag in tagsList}
    print(f"got these input tags: {tagsList} and produced this output: {resp}")

    return resp


# Backwards-compatible wrapper for existing code that only expects category
def classify_category_only(
    input_text: str, classes: Union[str, List[str]]
) -> Dict[str, Any]:
    """
    Legacy function - only returns category classification.
    Use classify() for full category + action classification.
    """
    classes_list = _normalize_classes(classes)
    return _classify_category(input_text, classes_list)
