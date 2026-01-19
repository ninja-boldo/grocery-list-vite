from typing import List, Union, Dict, Literal, Any, Optional
from pydantic import BaseModel, Field, ValidationError
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
import os
import json
import re
import ast

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


BASE_TAGS = [
    # Dairy & Alternatives
    "milk",
    "cheese",
    "yogurt",
    "butter",
    "cream",
    "sour cream",
    "cottage cheese",
    "cream cheese",
    "quark",
    "kefir",
    "plant milk",
    "vegan cheese",
    # Proteins
    "beef",
    "pork",
    "chicken",
    "turkey",
    "lamb",
    "fish",
    "salmon",
    "tuna",
    "shrimp",
    "eggs",
    "tofu",
    "tempeh",
    "seitan",
    # Grains & Starches
    "rice",
    "pasta",
    "noodles",
    "bread",
    "rolls",
    "bagel",
    "tortilla",
    "couscous",
    "quinoa",
    "oats",
    "cereal",
    "flour",
    "cornmeal",
    # Fruits & Vegetables
    "apple",
    "banana",
    "orange",
    "berries",
    "tomato",
    "lettuce",
    "carrot",
    "potato",
    "onion",
    "garlic",
    "pepper",
    "cucumber",
    "spinach",
    # Snacks & Sweets
    "chips",
    "crackers",
    "cookies",
    "candy",
    "chocolate",
    "gum",
    "nuts",
    "popcorn",
    "pretzels",
    "granola bar",
    "protein bar",
    "bonbons",
    # Beverages
    "water",
    "juice",
    "soda",
    "tea",
    "coffee",
    "beer",
    "wine",
    "cider",
    "energy drink",
    "sports drink",
    "kombucha",
    # Condiments & Sauces
    "ketchup",
    "mustard",
    "mayonnaise",
    "vinegar",
    "oil",
    "soy sauce",
    "hot sauce",
    "bbq sauce",
    "salad dressing",
    "jam",
    "honey",
    "syrup",
    "peanut butter",
    "nutella",
    "pesto",
    "salsa",
    # Baking & Cooking
    "sugar",
    "salt",
    "pepper",
    "spices",
    "baking soda",
    "baking powder",
    "yeast",
    "vanilla extract",
    "broth",
    "stock",
    # Frozen & Prepared
    "ice cream",
    "frozen pizza",
    "frozen vegetables",
    "frozen fruit",
    "ready meal",
    "soup",
    "canned beans",
    "canned tomatoes",
    # Household (if you track these)
    "dish soap",
    "laundry detergent",
    "paper towels",
    "toilet paper",
    # Fallback
    "unknown",
]

# Flavor/Variety/Subtype tags
FLAVOR_TAGS = [
    "none",
    "plain",
    "original",
    # Fruit flavors
    "apple",
    "banana",
    "orange",
    "lemon",
    "lime",
    "strawberry",
    "raspberry",
    "blueberry",
    "cherry",
    "grape",
    "peach",
    "mango",
    "pineapple",
    "coconut",
    "watermelon",
    "pear",
    "apricot",
    "blackberry",
    "cranberry",
    # Savory flavors
    "salt",
    "sea salt",
    "cheese",
    "cheddar",
    "sour cream",
    "bbq",
    "barbecue",
    "salt and vinegar",
    "paprika",
    "onion",
    "garlic",
    "herbs",
    "pepper",
    "chili",
    "spicy",
    "jalapeño",
    "buffalo",
    "ranch",
    "bacon",
    # Sweet flavors
    "vanilla",
    "chocolate",
    "caramel",
    "honey",
    "cinnamon",
    "mint",
    "hazelnut",
    "almond",
    "peanut",
    "coffee",
    "mocha",
    # Candy/confection specific
    "menthol",
    "eucalyptus",
    "licorice",
    "fruit mix",
    "cola",
    "bubblegum",
    # Tea/coffee varieties
    "earl grey",
    "green tea",
    "black tea",
    "chamomile",
    "peppermint",
    "english breakfast",
    "jasmine",
    "oolong",
    "espresso",
    "arabica",
    "robusta",
    # Meat preparations
    "smoked",
    "grilled",
    "fried",
    "roasted",
    "ground",
    "sliced",
    # Dietary
    "organic",
    "whole wheat",
    "multigrain",
    "gluten free",
    "sugar free",
    "low fat",
    "fat free",
    "lactose free",
    "vegan",
    "vegetarian",
    # Regional/Style
    "italian",
    "mexican",
    "asian",
    "indian",
    "thai",
    "greek",
    "french",
    # General descriptors
    "extra virgin",
    "aged",
    "fresh",
    "dried",
    "unsalted",
    "salted",
    "sweetened",
    "unsweetened",
    "carbonated",
    "still",
    "sparkling",
]

# Form/Physical state tags
FORM_TAGS = [
    "none",
    # States
    "liquid",
    "solid",
    "powder",
    "gel",
    "paste",
    "cream",
    "foam",
    # Food-specific forms
    "grain",
    "flakes",
    "leaves",
    "ground",
    "whole",
    "sliced",
    "diced",
    "shredded",
    "grated",
    "chopped",
    "frozen",
    "fresh",
    "dried",
    "canned",
    "bottled",
    "jarred",
    "bagged",
    "boxed",
    # Candy/snack forms
    "tablet",
    "lozenge",
    "gummy",
    "hard candy",
    "chewy",
    "crunchy",
    "soft",
    "crispy",
    # Prepared forms
    "ready to eat",
    "ready to cook",
    "instant",
    "concentrate",
    # Packaging-related (if relevant)
    "carbonated",
    "still",
    "aerosol",
    "spray",
]


TAG_TO_SHORTNAME_BATCH_PROMPT = """You are a grocery product name generator.

Your task:
For EACH tag combination, independently generate a natural short name that a person would use.

IMPORTANT:
- Treat each tag combination independently.
- Do NOT compare combinations.
- Preserve input order exactly.
- Generate natural, human-readable names.
- Return only valid JSON. No extra text.

INPUT FORMAT:
Each tag combination consists of exactly 3 elements in this order:
1. base - the main product type (e.g., "bread", "tea", "chips")
2. flavor - the flavor/subtype or "none" if plain/unflavored
3. form - the physical form or "none" if not specified

NAME GENERATION RULES:
1. Always include the base in the short name
2. Include flavor ONLY if it's not "none"
3. NEVER include form in the name (form is metadata, not part of the name)
4. Use natural word order for the language (usually flavor + base in English)
5. Keep it minimal - 1-3 words maximum
6. Use lowercase
7. No articles (no "a", "the", etc.)
8. Singular form preferred unless plural is more natural

Examples:
- ["bread", "none", "none"] → "bread"
- ["tea", "earl grey", "leaves"] → "earl grey tea"
- ["chips", "paprika", "solid"] → "paprika chips"
- ["milk", "none", "liquid"] → "milk"
- ["candy", "menthol", "solid"] → "menthol candy"
- ["couscous", "none", "grain"] → "couscous"
- ["yogurt", "strawberry", "gel"] → "strawberry yogurt"
- ["cheese", "cheddar", "solid"] → "cheddar cheese"
- ["juice", "orange", "liquid"] → "orange juice"
- ["cookie", "chocolate chip", "solid"] → "chocolate chip cookie"

OUTPUT FORMAT:
Return EXACTLY one valid JSON object.
Each key is the ORIGINAL tag combination as a string "base, flavor, form".
Each value is the generated short name as a string.

Example output:
{{
  "apricot, marmelade, gel": "apricot marmelade",
  "bread, none, none": "bread",
  "tea, earl grey, leaves": "earl grey tea",
  "chips, paprika, solid": "paprika chips"
}}

Now generate short names for the following tag combinations:

Tag combinations (format: "base, flavor, form"):
{tag_combinations}

Return ONLY valid JSON, no explanations."""

TAG_ASSIGNMENT_BATCH_PROMPT = """You are a grocery product classifier.

Your task:
For EACH database row, independently assign semantic tags that describe the product.

IMPORTANT:
- Treat each row independently.
- Do NOT compare rows.
- Preserve input order exactly.
- Use the shortened name as the primary signal.
- Use the original name only for clarification.
- Categories are hints only and may be missing.
- Return only valid JSON. No extra text.

ALLOWED TAGS - you MUST pick from these lists:
Base tags: {base_tags}
Flavor/Subtype tags: {flavor_tags}
Form tags: {form_tags}

Normalization rules:
- lowercase
- singular nouns where it makes sense
- no brand names in tags (brands go in shortened name, not tags)
- no marketing adjectives
- 1-3 words per field
- ASCII where possible
- ALWAYS pick from the allowed lists above - never invent new tags
- use 'none' if no tag fits
- use 'unknown' for base only if product type is completely unclear

MATCHING STRATEGY:
1. First try to find EXACT or VERY CLOSE match in allowed tags
2. If no close match, pick the most GENERAL category that fits
   - Example: "Chipsfrisch Ungarisch" → base="chips" (not "potato chips" or "snack")
   - Example: "Fisherman's Friend" → base="candy" (general), flavor="menthol", form="solid"
3. For flavors: match the actual flavor/variety, use "none" if plain/unflavored
4. For forms: liquid, solid, powder, gel, paste, leaves, grain, tablet, etc.

Rules:
1. Use the shortened name ('class') as the PRIMARY signal.
2. Only use original name or categories as clarification.
3. Prefer matching to general categories over 'unknown'
4. Categories are weak hints from Open Food Facts; only guide disambiguation.
5. If completely unclear after checking all options, use: base='unknown', flavor='none', form='none'
6. Do NOT translate.
7. Be generous with matching - "bonbons" matches "candy", "thé" matches "tea", etc.

OUTPUT FORMAT:
Return EXACTLY one valid JSON object.
Each key is the ORIGINAL item name.
Each value has this structure:
{{
  "base": "<base product tag>",
  "flavor": "<flavor/subtype tag or 'none'>",
  "form": "<form tag or 'none'>"
}}

Examples:
{{"Coucous": {{"base": "couscous", "flavor": "none", "form": "grain"}}}},
{{"Menthol Extra Stark Ohne Zucker": {{"base": "candy", "flavor": "menthol", "form": "solid"}}}},
{{"Thé Earl Grey Classic": {{"base": "tea", "flavor": "earl grey", "form": "leaves"}}}},
{{"milk": {{"base": "milk", "flavor": "none", "form": "liquid"}}}},
{{"Chipsfrisch Ungarisch": {{"base": "chips", "flavor": "paprika", "form": "solid"}}}}

Now classify the following rows (use ORIGINAL item names as keys):

item_name (original names, same order):
{item_names}

class (shortened names, same order):
{shortened_names}

categories (list of categories, same order; may be empty):
{categories}

Return ONLY valid JSON, no explanations."""

SHORTEN_BATCH_TMPL = """You are a product name normalizer. Shorten and normalize product names into a concise, recognizable format while maintaining brand identity.

RULES:

REMOVE MARKETING WORDS: Bio, Extra, Stark, Natives, Natur, Ohne Zucker, Classic, Griechisches, etc.

KEEP BRAND NAMES: They help people identify products (Nutella, Chipsfrisch, Ricola, Lindt, etc.).

HINTS: Categories are provided as hints, but PREFER keeping recognizable brand names.

EDGE CASES: If a brand is not iconic, you MAY use "Category + Flavor" for clarity.

NEVER TRANSLATE: Keep the original language (French stays French, Spanish stays Spanish, etc.).

PRODUCT TYPE: Only add if 100% certain it adds necessary clarity.

FLAVOR: Keep flavor/variant details that help identify specific products.

SPELLING: Correct minor typos (e.g., Coucous -> Couscous).

CLEANUP: Remove trailing words like "the" if not part of the name.

UNCERTAINTY: If unsure, keep the original name.

OUTPUT FORMAT: Return EXACTLY one JSON object. No extra text. {{"original_item_name": "shortenedText"}}

EXAMPLES:

"Thé Earl Grey Classic": "Earl Grey"

"Menthol Extra Stark Ohne Zucker": "Menthol Bonbons"

"Chipsfrisch Ungarisch": "Chips Ungarisch"

"Ricola Kräuter Bonbons": "Ricola Bonbons"

"Nutella Brotaufstrich": "Nutella"

"Griechisches Natives Olivenöl Extra": "Olivenöl"

"Extra Stark Ricola": "Ricola Bonbons"

"Bonne Maman Confiture": "Bonne Maman"

INPUT DATA: Items: {items_list} Categories: {category_list}
"""

SHORTEN_TMPL = """
Shorten and normalize product name: "{input}"
Categories (use as hints only): "{categories}"

RULES:
1. Remove marketing words: Bio, Extra, Stark, Natives, Natur, Ohne Zucker, Classic, Griechisches
2. KEEP BRAND NAMES - they help people identify products (Nutella, Chipsfrisch, Lindt, Ricola, etc.)
3. Categories are hints - still PREFER keeping recognizable brand names
4. Only in narrow edge cases where brand is not iconic, you MAY use category + flavor if clearer
5. NEVER TRANSLATE - maintain input language (German→German, French→French, Spanish→Spanish, etc.)
6. Keep or ADD product type ONLY if you are absolutely certain:
   - Menthol/Ricola/Fisherman's Friend → clearly Bonbons
   - Tea/Thé varieties → keep type
   - If product type is already present, keep it
   - If product type is missing but OBVIOUS from context, add it
7. For branded products, keep brand (maybe + variant/flavor if distinctive)
8. When uncertain about product type, DON'T add it
9. Remove trailing 'the' if not part of the product name
10. If it makes sense you can correct spelling like you could with e.g. Coucous -> Couscous
11. Goal: be descriptive so people easily understand what it is

Examples:
'Thé Earl Grey Classic' → Earl Grey
'Menthol Extra Stark Ohne Zucker' → Menthol Bonbons
'Chipsfrisch Ungarisch' → Chips Ungarisch
'Ricola Kräuter Bonbons' → Ricola Bonbons
'Nutella Brotaufstrich' → Nutella
'Lindt Schokolade Nuss' → Lindt Nuss
'Aprikose' → Aprikose
'Extra Aprikose' → Aprikose
'Holler Zwetschken Konfitüre' → Zwetschken Marmelade
'Griechisches Natives Olivenöl Extra' → Olivenöl
'Bio Apfel Essig' → Apfel Essig
'Balsamico-Creme' → Balsamico
'Coucous' → Couscous
'milk' → milk
'cookies' → cookies
'Bonne Maman Confiture' → Bonne Maman

Return EXACTLY one JSON object:
{{"shortenedText":"result here"}}

CRITICAL: Keep brand names, never translate, only add types when 100% certain.
"""

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
        ) # type: ignore
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


def tagAssignmentBatch(
    items: list[dict[str, str]],
    base_tags: List[str] = BASE_TAGS,
    flavor_tags: List[str] = FLAVOR_TAGS,
    form_tags: List[str] = FORM_TAGS,
    batch_size: int = 50,
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

    Example with your DB format:
        >>> item_names = ["Coucous", "milk", "Menthol Extra Stark Ohne Zucker"]
        >>> shortened = ["Couscous", "Milk", "Bonbons menthol zucker"]
        >>> categories = [
        ...     "['en:cereals-and-potatoes', 'en:durum-wheat-semolinas']",
        ...     "",
        ...     "['en:candies', 'en:hard-candies']"
        ... ]
        >>> results = tagAssignmentBatch(
        ...     item_names=item_names,
        ...     shortened_names=shortened,
        ...     categories=categories,
        ...     base_tags=["couscous", "milk", "candy"],
        ...     flavor_tags=["none", "menthol"],
        ...     form_tags=["grain", "liquid", "solid"]
        ... )
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

    # Ensure "none" and "unknown" are in tag lists
    if "none" not in flavor_tags:
        flavor_tags = flavor_tags + ["none"]
    if "none" not in form_tags:
        form_tags = form_tags + ["none"]
    if "unknown" not in base_tags:
        base_tags = base_tags + ["unknown"]

    llm = _get_llm()
    prompt = ChatPromptTemplate.from_template(TAG_ASSIGNMENT_BATCH_PROMPT)
    chain = prompt | llm

    all_results = {}

    # Process in batches to avoid token limits
    for i in range(0, len(item_names), batch_size):
        batch_items = item_names[i : i + batch_size]
        batch_shortened = shortened_names[i : i + batch_size]
        batch_categories = parsed_categories[i : i + batch_size]

        try:
            result = chain.invoke(
                {
                    "item_names": batch_items,
                    "shortened_names": batch_shortened,
                    "categories": batch_categories,
                    "base_tags": ", ".join(base_tags),
                    "flavor_tags": ", ".join(flavor_tags),
                    "form_tags": ", ".join(form_tags),
                }
            )

            text_content = result.content if hasattr(result, "content") else str(result)
            parsed = extract_batch_json(text_content)

            # Validate and normalize results
            for item_name in batch_items:
                if item_name in parsed and isinstance(parsed[item_name], dict):
                    tags = parsed[item_name]
                    # tags = json.dumps(tags)
                    all_results[item_name] = {
                        "base": _validate_tag(tags.get("base", "unknown"), base_tags),
                        "flavor": _validate_tag(
                            tags.get("flavor", "none"), flavor_tags
                        ),
                        "form": _validate_tag(tags.get("form", "none"), form_tags),
                    }
                else:
                    # Fallback for failed items
                    all_results[item_name] = {
                        "base": "unknown",
                        "flavor": "none",
                        "form": "none",
                    }

        except Exception as e:
            print(f"Error processing batch {i // batch_size + 1}: {e}")
            # Fallback for entire batch
            for item_name in batch_items:
                all_results[item_name] = {
                    "base": "unknown",
                    "flavor": "none",
                    "form": "none",
                }

    print(
        f"Processed {len(item_names)} items in {(len(item_names) + batch_size - 1) // batch_size} batches. "
        f"Results: {len(all_results)} tagged items"
    )

    return all_results


def tagToNameBatch(tagsList: list[str]):
    print(f"started the tag to name batching with this input: {tagsList}")
    llm = _get_llm()

    prompt = ChatPromptTemplate.from_template(TAG_TO_SHORTNAME_BATCH_PROMPT)
    chain = prompt | llm

    try:
        result = chain.invoke({"tag_combinations": tagsList})

        # Extract the text content from the response
        text_content: str = (
            result.content if hasattr(result, "content") else str(result)
        )  # type: ignore
        out = extract_batch_json(text_content)
    except Exception as e:
        print(f"Error during category classification: {e}")
        return None

    resp = {tag: out.get(tag, "failed") for tag in tagsList}
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

