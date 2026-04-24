# lookups.py – Single source of truth for all static data, normalization helpers,
# pre-computed lookup tables, and LLM prompt templates.

import json
import re
import unicodedata
from typing import Any


from utils.types_custom import (
    ClassificationWishListVsPantryInternal,
    ItemClassificationRes,
    ShortenNamesRes,
    WishMappingRes,
)


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Resolve all $ref pointers and inline them. Required for Groq strict mode."""
    defs = schema.get("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(defs[ref_name].copy())
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [resolve(i) for i in node]
        return node

    return resolve(schema)


def _apply_groq_strict_object_rules(node: Any) -> None:
    """Groq strict json_schema expects additionalProperties:false on every object."""
    if isinstance(node, dict):
        if node.get("type") == "object" and "additionalProperties" not in node:
            node["additionalProperties"] = False
        for value in node.values():
            _apply_groq_strict_object_rules(value)
        return

    if isinstance(node, list):
        for value in node:
            _apply_groq_strict_object_rules(value)


def _strict_schema_from_model(model: Any) -> dict[str, Any]:
    schema = model.model_json_schema()
    schema = _inline_refs(schema)
    _apply_groq_strict_object_rules(schema)
    return schema


# ─── Category descriptions (bi-encoder passage embeddings) ───────────────────

CATEGORIES: list[str] = [
    "fruit vegetables",
    "dairy eggs",
    "bread bakery pastries",
    "snacks chips nuts",
    "meat poultry fish seafood",
    "grains rice pasta legumes",
    "canned preserved foods",
    "sauces spreads dips",
    "oils vinegars dressings",
    "spices herbs seasoning",
    "baking ingredients",
    "drinks beverages",
    "personal care hygiene",
    "household cleaning",
    "frozen foods",
    "other",
]


CLASS_DESCRIPTIONS: dict[str, str] = {
    "fruit vegetables": (
        "Obst und Gemüse: frisches Obst, Gemüse, Kräuter, Salat, Pilze, Knoblauch, "
        "Zwiebeln, Kartoffeln, Möhren, Karotten, Avocado, Beeren, Äpfel, Bananen, "
        "Tomaten, Gurken, Paprika frisch, Zucchini, Brokkoli, Spinat, Champignons, "
        "Honigmelone, Wassermelone, Melone, honey melon, watermelon, "
        "légumes frais, fruits frais, verduras frescas, frutas frescas, "
        "zanahorias, aguacate, tomates, pepino"
    ),
    "dairy eggs": (
        "Milchprodukte und Eier: Joghurt, Käse, Butter, Milch, milk, Quark, "
        "Frischkäse, cream cheese, Jben, fromage frais, Eier, Sahne, Skyr, "
        "Mozzarella, Hafermilch, Mandelmilch, Sojamilch, Alpro, "
        "pflanzliche Milchalternativen, lait, beurre, œufs, fromage, "
        "crème, leche, yogur, huevos"
    ),
    "bread bakery pastries": (
        "Brot, Backwaren und Gebäck: Brot, Brötchen, Kuchen, Toast, Croissant, "
        "Baguette, Vollkornbrot, Roggenbrot, Laugengebäck, Muffins, pain, "
        "viennoiserie, pan integral, pan de mie, pan rebanado"
    ),
    "snacks chips nuts": (
        "Snacks, Chips, Nüsse und Süßigkeiten: Schokolade, Milka, Ritter Sport, "
        "Excellence Noir, dunkle Schokolade, Bitterschokolade, Kakaoschokolade, "
        "Gummibären, Haribo, Chips, Crunchips, Kekse, Popcorn, Riegel, "
        "Proteinriegel, Erdnüsse, Mandeln, Walnüsse, Müsliriegel, Bonbons, "
        "Patatas fritas, crisps, chocolat noir, chocolat au lait, biscuits, noix, "
        "patatas fritas sabor, snacks salados, pâte de cacao"
    ),
    "meat poultry fish seafood": (
        "Fleisch, Geflügel, Fisch und Meeresfrüchte: Hähnchen, Rind, Schwein, "
        "Lachs, Thunfisch, Garnelen, Aufschnitt, Wurst, Salami, Schinken, "
        "Fischfilet, viande, poulet, poisson, jambon, pollo, atún, atun, "
        "pollo troceado, filet de poulet"
    ),
    "grains rice pasta legumes": (
        "Getreide, Reis, Nudeln und Hülsenfrüchte: Spaghetti, Reis, Linsen, "
        "Kichererbsen, Haferflocken, Müsli, Quinoa, Couscous, Bulgur, Bohnen, "
        "Erbsen, pâtes, riz, légumineuses, arroz, lentejas, garbanzos"
    ),
    "canned preserved foods": (
        "Konserven und haltbare Lebensmittel in Dosen oder Gläsern: "
        "Dosentomaten, Thunfisch in Dose, Kichererbsen aus der Dose, "
        "Mais in Dose, Bohnen aus der Dose, Ravioli in Dose, Suppen, "
        "conserves, plats préparés en boîte, conservas en lata, "
        "thon en conserve, pois chiches en boîte"
    ),
    "sauces spreads dips": (
        "Saucen, Aufstriche und Dips: Senf, Ketchup, Mayonnaise, Marmelade, "
        "Konfitüre, Erdbeermarmelade, Aprikosenmarmelade, Pesto, Tapenade, "
        "Hummus, Erdnussbutter, Nussnougatcreme, Nocciolata, "
        "pâte à tartiner noisettes, pâte à tartiner chocolat, Nutella, "
        "BBQ-Sauce, Sojasauce, Honig, honig, honey, Sirup, "
        "sauce, confiture de fraise, confiture d abricot, moutarde, "
        "mermelada de fresa, mermelada de albaricoque, salsa de tomate, "
        "miel, miel de fleurs"
    ),
    "oils vinegars dressings": (
        "Öle, Essig und Dressings: Olivenöl, Rapsöl, Apfelessig, Salatdressing, "
        "Kokosöl, Sonnenblumenöl, Balsamico, Weinessig, aceite de oliva, "
        "huile d'olive, vinaigre, vinaigrette"
    ),
    "spices herbs seasoning": (
        "Gewürze, Kräuter und Würzmittel: Salz, Pfeffer, Paprikapulver edelsüß, "
        "Pimentón, Knoblauchpulver, Zimt, Kümmel, Gemüsebrühe, Bouillon, "
        "Curry, Oregano, Basilikum getrocknet, Thymian getrocknet, Cumin, "
        "getrocknete Kräuter, épices, herbes séchées, bouillon de légumes, "
        "pimenton dulce molido, especias"
    ),
    "baking ingredients": (
        "Backzutaten: Mehl, Weizenmehl, Dinkelmehl, Zucker, Backpulver, Hefe, "
        "Vanille, Puderzucker, Speisestärke, Natron, Kakaopulver, "
        "Schokoladendrops, harina de trigo, farine, sucre, levure, azúcar"
    ),
    "drinks beverages": (
        "Getränke: Fruchtsaft, Wasser, Mineralwasser, Kaffee, Tee, "
        "Milchgetränke, Softdrinks, Cola, Limonade, Eistee, Energydrink, "
        "Smoothie, jus d orange, eau minérale, café, thé, "
        "agua mineral, zumo, bebida, agua con gas"
    ),
    "personal care hygiene": (
        "Körperpflege und Hygiene: Shampoo, Duschgel, Zahnpasta, Deo, "
        "Hautcreme, Rasierer, Seife, Tampons, Windeln, Bodylotion, "
        "Sonnencreme, Mundwasser, shampooing antipelliculaire, gel douche, "
        "dentifrice, pasta dental, jabón, champú"
    ),
    "household cleaning": (
        "Haushalt und Reinigung: Spülmittel, Waschmittel, Allzweckreiniger, "
        "Schwämme, Müllbeutel, WC-Reiniger, Weichspüler, Küchentücher, "
        "liquide vaisselle, lessive, nettoyant, detergente lavadora, "
        "limpiador, limpiahogar"
    ),
    "frozen foods": (
        "Tiefkühlprodukte: Tiefkühlpizza, TK-Gemüse, Speiseeis, Eiscreme, "
        "Tiefkühlfisch, gefrorene Pommes Frites, TK-Fertiggerichte, Rahmspinat, "
        "Tiefkühlerbsen, Fischstäbchen, surgelés, légumes surgelés wok, "
        "pizza surgelée, pizza congelada, verduras congeladas, helado"
    ),
    "other": (
        "Sonstiges: Tiernahrung, Katzenfutter, Hundefutter, Büroartikel, "
        "Batterien, Kerzen, sonstige Non-Food-Produkte die keiner anderen "
        "Kategorie entsprechen"
    ),
}

# Concise taxonomy strings used by the cross-encoder reranker
RERANKER_TAXONOMY: dict[str, str] = {
    "fruit vegetables": "fresh fruit, vegetables, produce, herbs, mushrooms",
    "dairy eggs": "milk, cheese, yogurt, butter, eggs, cream, plant-based milk alternatives",
    "bread bakery pastries": "bread, rolls, toast, croissant, baguette, cake, pastry",
    "snacks chips nuts": "chocolate, candy, chips, crisps, nuts, cookies, protein bar, granola bar",
    "meat poultry fish seafood": "chicken, beef, pork, salmon, tuna, fish fillet, shrimp, sausage, deli meat",
    "grains rice pasta legumes": "pasta, spaghetti, rice, lentils, oats, chickpeas, beans, couscous, quinoa",
    "canned preserved foods": "canned tomatoes, canned tuna, canned beans, canned chickpeas, preserved food in tins or jars",
    "sauces spreads dips": "ketchup, mustard, pesto, jam, honey, nut butter, Nutella, hummus, BBQ sauce",
    "oils vinegars dressings": "olive oil, sunflower oil, vinegar, salad dressing",
    "spices herbs seasoning": "salt, pepper, paprika, cumin, oregano, stock cube, bouillon, dried herbs",
    "baking ingredients": "flour, sugar, baking powder, yeast, vanilla, cocoa powder",
    "drinks beverages": "juice, water, coffee, tea, soda, smoothie, energy drink, milk drink, protein shake, hot chocolate powder",
    "personal care hygiene": "shampoo, shower gel, toothpaste, deodorant, skin cream, sunscreen, soap",
    "household cleaning": "dish soap, laundry detergent, all-purpose cleaner, sponge, toilet cleaner",
    "frozen foods": "frozen pizza, frozen vegetables, ice cream, frozen fish, fish fingers, frozen fries, frozen ready meals",
    "other": "pet food, batteries, candles, non-food items",
}

# OpenFoodFacts taxonomy → internal bucket mapping
OFF_TO_BUCKET: dict[str, str] = {
    "en:condiments": "sauces spreads dips",
    "en:sauces": "sauces spreads dips",
    "en:dips": "sauces spreads dips",
    "en:vinegars": "oils vinegars dressings",
    "en:ketchup": "sauces spreads dips",
    "en:pestos": "sauces spreads dips",
    "en:hot-sauces": "sauces spreads dips",
    "en:soy-sauces": "sauces spreads dips",
    "en:fats": "oils vinegars dressings",
    "en:vegetable-oils": "oils vinegars dressings",
    "en:syrups": "sauces spreads dips",
    "en:agave-syrup": "sauces spreads dips",
    "en:honey": "sauces spreads dips",
    "en:breakfasts": "bread bakery pastries",
    "en:spreads": "sauces spreads dips",
    "en:sweet-spreads": "sauces spreads dips",
    "en:hazelnut-spreads": "sauces spreads dips",
    "en:chocolate-spreads": "sauces spreads dips",
    "en:cocoa-and-hazelnuts-spreads": "sauces spreads dips",
    "fr:pates-a-tartiner": "sauces spreads dips",
    "en:snacks": "snacks chips nuts",
    "en:salty-snacks": "snacks chips nuts",
    "en:candies": "snacks chips nuts",
    "en:confectioneries": "snacks chips nuts",
    "en:chips-and-fries": "snacks chips nuts",
    "en:potato-crisps": "snacks chips nuts",
    "en:dairies": "dairy eggs",
    "en:cheeses": "dairy eggs",
    "en:fermented-milk-products": "dairy eggs",
    "en:eggs": "dairy eggs",
    "en:meats": "meat poultry fish seafood",
    "en:prepared-meats": "meat poultry fish seafood",
    "en:sausages": "meat poultry fish seafood",
    "en:seafood": "meat poultry fish seafood",
    "en:fishes": "meat poultry fish seafood",
    "en:tunas": "meat poultry fish seafood",
    "en:fruits-and-vegetables-based-foods": "fruit vegetables",
    "en:fruit-and-vegetable-preserves": "sauces spreads dips",
    "en:jams": "sauces spreads dips",
    "en:berry-jams": "sauces spreads dips",
    "en:apple-compotes": "sauces spreads dips",
    "en:fruit-compotes": "sauces spreads dips",
    "en:apples": "fruit vegetables",
    "en:berries": "fruit vegetables",
    "en:apricots": "fruit vegetables",
    "en:cereals-and-their-products": "grains rice pasta legumes",
    "en:pastas": "grains rice pasta legumes",
    "en:noodles": "grains rice pasta legumes",
    "en:dry-pastas": "grains rice pasta legumes",
    "en:rice": "grains rice pasta legumes",
    "en:legumes": "grains rice pasta legumes",
    "en:beverages": "drinks beverages",
    "en:plant-based-beverages": "drinks beverages",
    "en:juices-and-nectars": "drinks beverages",
    "en:soft-drinks": "drinks beverages",
    "en:alcoholic-beverages": "drinks beverages",
    "en:gewurze": "spices herbs seasoning",
    "en:gewurzmittel": "spices herbs seasoning",
    "en:curry-pastes": "spices herbs seasoning",
    "en:herbs": "spices herbs seasoning",
    "en:spices": "spices herbs seasoning",
}

# Keyword overrides – fire before embedding (cheap, deterministic)
KEYWORD_OVERRIDES: dict[str, str] = {
    # produce
    "moehren": "fruit vegetables",
    "karotten": "fruit vegetables",
    "kartoffel": "fruit vegetables",
    "kartoffeln": "fruit vegetables",
    "zwiebel": "fruit vegetables",
    "zwiebeln": "fruit vegetables",
    "champignon": "fruit vegetables",
    "zucchini": "fruit vegetables",
    "brokkoli": "fruit vegetables",
    "spinat": "fruit vegetables",
    "zanahorias": "fruit vegetables",
    "aguacate": "fruit vegetables",
    "melone": "fruit vegetables",
    "honigmelone": "fruit vegetables",
    "honey melon": "fruit vegetables",
    "watermelon": "fruit vegetables",
    # frozen
    "tiefkuehl": "frozen foods",
    "frozen": "frozen foods",
    "ice cream": "frozen foods",
    "nuggets": "frozen foods",
    "fish fingers": "frozen foods",
    "surgeles": "frozen foods",
    "surgelado": "frozen foods",
    "congelado": "frozen foods",
    "congelada": "frozen foods",
    "congelados": "frozen foods",
    "speiseeis": "frozen foods",
    "eiscreme": "frozen foods",
    # cleaning
    "waschmittel": "household cleaning",
    "spuelmittel": "household cleaning",
    "weichspueler": "household cleaning",
    "detergente": "household cleaning",
    "limpiahogar": "household cleaning",
    "dish soap": "household cleaning",
    "dishwasher tablets": "household cleaning",
    "cleaner spray": "household cleaning",
    "cleaning spray": "household cleaning",
    "dishwasher": "household cleaning",
    # personal care
    "zahnpasta": "personal care hygiene",
    "duschgel": "personal care hygiene",
    "shampooing": "personal care hygiene",
    "champue": "personal care hygiene",
    "dental": "personal care hygiene",
    "sonnencreme": "personal care hygiene",
    # snacks
    "chips": "snacks chips nuts",
    "crisps": "snacks chips nuts",
    "crunchips": "snacks chips nuts",
    "pringles": "snacks chips nuts",
    "patatas fritas": "snacks chips nuts",
    # spices / seasoning
    "gemuesebruehe": "spices herbs seasoning",
    "huehnerbruehe": "spices herbs seasoning",
    "rinderbruehe": "spices herbs seasoning",
    "bruehwuerfel": "spices herbs seasoning",
    # dairy
    "freilandeier": "dairy eggs",
    "eier": "dairy eggs",
    # pet food → other
    "katzenfutter": "other",
    "hundefutter": "other",
    "tiernahrung": "other",
    "petfood": "other",
}

# ─── Text normalisation ───────────────────────────────────────────────────────

NORMALIZE_TRANS = str.maketrans({"ß": "ss", "ä": "ae", "ö": "oe", "ü": "ue"})
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
GRAM_WEIGHT_RE = re.compile(r"\b\d{2,3}\s*g\b")
SAUCE_NEIGHBOURS: frozenset[str] = frozenset(
    {"dressing", "sauce", "oel", "oil", "vinaigrette"}
)
BROTH_TOKENS: frozenset[str] = frozenset({"bouillon", "bruehe", "bruehwuerfel"})


def normalize_for_match(text: str) -> str:
    t = text.lower().translate(NORMALIZE_TRANS)
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")
    return NON_ALNUM_RE.sub(" ", t).strip()


# ─── Pre-computed keyword lookup tables ──────────────────────────────────────

_NORMALIZED_OVERRIDES: dict[str, str] = {
    nk: v for k, v in KEYWORD_OVERRIDES.items() if (nk := normalize_for_match(k))
}

MULTI_WORD_OVERRIDES: dict[str, str] = {
    k: v for k, v in _NORMALIZED_OVERRIDES.items() if " " in k
}
SINGLE_WORD_OVERRIDES: dict[str, str] = {
    k: v for k, v in _NORMALIZED_OVERRIDES.items() if " " not in k
}
_PREFIX_OVERRIDES: dict[str, str] = {
    k: v for k, v in SINGLE_WORD_OVERRIDES.items() if len(k) >= 5
}
MULTI_WORD_OVERRIDE_ITEMS: list[tuple[str, str]] = sorted(
    MULTI_WORD_OVERRIDES.items(), key=lambda x: len(x[0]), reverse=True
)

PREFIX_OVERRIDES_BY_HEAD: dict[str, list[tuple[str, str]]] = {}
for _p, _l in _PREFIX_OVERRIDES.items():
    PREFIX_OVERRIDES_BY_HEAD.setdefault(_p[0], []).append((_p, _l))
for _opts in PREFIX_OVERRIDES_BY_HEAD.values():
    _opts.sort(key=lambda x: len(x[0]), reverse=True)

# ─── Reranker label texts ─────────────────────────────────────────────────────


def build_reranker_label_text(label: str) -> str:
    taxonomy = RERANKER_TAXONOMY[label]
    details = CLASS_DESCRIPTIONS.get(label, taxonomy)
    return f"{label}. taxonomy: {taxonomy}. details: {details}"


RERANKER_LABEL_TEXTS: dict[str, str] = {
    label: build_reranker_label_text(label) for label in CLASS_DESCRIPTIONS
}

# ─── LLM prompt templates ────────────────────────────────────────────────────


schema = json.dumps(ShortenNamesRes.model_json_schema())
SHORTEN_BATCH_TMPL = {
    "system": f"""You are an expert German grocery list normalizer.
Your task is to convert raw, messy product descriptions into clean, properly capitalized, lean shopping list items.

if there is something 
### Examples of Expected Behavior:
"haltbare milch" → "Milch"
"ungesüßt skyr 400g" → "Joghurt"
"basmati reis" → "Reis"
"indian chicken tikka" → "Chicken Tikka"
"sahne zum kochen" → "Sahne"
"körniger frischkäse" → "Frischkäse"
"veg. salatmayo" → "Mayonnaise"

Return JSON matching this schema exactly:
{schema}

Every input item must appear in the output with its exact original_name preserved.""",
    "user": "Normalize the following raw input items:\n{items}",
}


Category_Batch_TMPL = {
    "system": """Classify each item into exactly one category from the provided list.
If uncertain, use "other".

Return JSON: {"items": [{"item": "<original>", "category": "<class>"}, ...]}""",
    "user": "Items: {items_list}\nClasses: {classes_list}",
}


WISH_Batch_TMPL = {
    "system": """For each item, pick the best matching wish from its wish_list.

Rules:
- Match same product type at the SAME specificity level — not ingredient/component
- "cream" ≠ "cream cheese", "Sahne" ≠ "Frischkäse", "Käse" ≠ "Mozzarella"
- Ignore brand, quantity, size, packaging, marketing adjectives
- Prefer most specific valid wish; if nothing fits use "other" or best fallback
- Any doubt → no match; prefer false negatives over false positives

Return JSON: {"items": [{"item": "<original>", "mapped_wish": "<wish>", "index_wish_list": <n>}, ...]}""",
    "user": "{item_wish_dict}",
}

CLASSIFY_AGAINST_PANTRY_TMPL = {
    "system": """Match each pantry item against the wish list. Return valid JSON matching the provided schema exactly.

Rules:
- Match when both items represent the SAME canonical ingredient at a similar specificity level
- Normalize away: quantity, units, size, packaging, brand, and marketing adjectives
- Allowed positive normalization examples:
    - "Danone ALPRO Joghurt Soja Natur ungesuessst" == "joghurt 400g"
    - "Milch fettarm 1L" == "milch"
- Still forbidden: substitutes, related categories, and different ingredient subtypes
- "parmesan" != "kaese", "kaese" != "mozzarella", "frischkaese" != "sahne"
- Multiple candidates: pick the most exact one; if no clear best canonical match, return no match
- No match: mappedWishItem=null, foundMappingWish=false
- Match found: mappedWishItem≠null, foundMappingWish=true
- Prefer precision, but do not reject clear canonical matches.""",
    "user": "pantry: {pantryItems}\nwish: {wishItems}",
}


# action classification templates
PROMPT_TMPL = {
    "system": """
Return only JSON, for example:
{{"category":"snacks","confidence":0.95}}

- category: one option from provided classes, else "unknown".
- confidence: float between 0.0 and 1.0.
""",
    "user": "Text: {text}\nClasses: {options}",
}

ACTION_PROMPT_TMPL: dict = {
    "system": """
        Classify intent of the grocery text.

        Possible actions:
        - add: user wants to add/increase item
        - remove: user wants to remove/decrease item
        - unknown: unclear intent

        Return only JSON, for example:
        {{"action":"add","confidence":0.95}}

        - action: add | remove | unknown
        - confidence: float between 0.0 and 1.0
    """,
    "user": "Text: {text}",
}

COMBINED_PROMPT_TMPL = {
    "system": """
Classify this grocery transcript in one pass.

Return only JSON, for example:
{
    "category":"dairy eggs",
    "category_confidence":0.95,
    "action":"add",
    "action_confidence":0.91
}

Rules:
- category must be in provided classes, else "unknown".
- action must be add | remove | unknown.
- confidence fields must be floats in [0.0, 1.0].
""",
    "user": "Text: {input}\nClasses: {classes}",
}

# ─── Response schemas ─────────────────────────────────────────────────────────

schema = _strict_schema_from_model(ClassificationWishListVsPantryInternal)
response_format_classify_against_pantry = {
    "type": "json_schema",
    "json_schema": {"name": "name_shortening", "strict": True, "schema": schema},
}

schema = _strict_schema_from_model(ItemClassificationRes)
response_format_classify_item = {
    "type": "json_schema",
    "json_schema": {"name": "item_categories", "strict": True, "schema": schema},
}

schema = _strict_schema_from_model(WishMappingRes)
response_format_map_wish_list = {
    "type": "json_schema",
    "json_schema": {"name": "wish_mapping", "strict": True, "schema": schema},
}


schema = _strict_schema_from_model(ShortenNamesRes)
response_format_shorten_names_batch = {
    "type": "json_schema",
    "json_schema": {"name": "name_shortening", "strict": True, "schema": schema},
}
