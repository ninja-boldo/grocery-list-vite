# server/classifier/classifier.py
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
from rich import print

INSTRUCTION = "extract this into one of these categories('meat_fish', 'fruit_veg', 'bread_bakery', 'grains_pasta', 'pantry_staples', 'spices_seasoning', 'snacks', 'drinks', 'frozen', 'household', 'canned_jars', 'dairy_eggs')"

class GroceryClassifier:
    def __init__(self):
        base_model = "NousResearch/Llama-3.2-1B"
        adapter_path = "./outputs/lora-out"
        tokenizer = AutoTokenizer.from_pretrained(adapter_path)
        model = AutoModelForCausalLM.from_pretrained(base_model, torch_dtype=torch.float32)
        model.resize_token_embeddings(len(tokenizer))
        self.model = PeftModel.from_pretrained(model, adapter_path).eval()
        
        self.tokenizer = tokenizer

    def classify(self, item: str) -> str:
        prompt = f"### Instruction:\n{INSTRUCTION}\n\n### Input:\n{item}\n\n### Response:\n"
        inputs = self.tokenizer(prompt, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model.generate(**inputs, max_new_tokens=20, do_sample=False)
        result = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        return result.split("### Response:")[-1].strip()

# Load once at startup
classifier = GroceryClassifier()

items = [
    # bread_bakery
    "dinkel brot", "vollkornbrot", "baguette", "croissant", "brioche",
    # pantry_staples
    "edeka feiner honig", "olivenöl", "tomatenmark", "mayonnaise", "senf",
    # drinks
    "beckers beste apfelsaft", "coca cola", "mineralwasser", "orange juice", "oat milk",
    # snacks
    "chocolate cake with cream", "chips", "erdnüsse", "gummibären", "kekse",
    # meat_fish
    "chicken breast", "lachs filet", "hackfleisch", "thunfisch dose", "speck",
    # fruit_veg
    "banana", "spinat", "karotten", "äpfel", "paprika",
    # grains_pasta
    "spaghetti", "basmatireis", "haferflocken", "couscous", "quinoa",
    # frozen
    "tiefkühlpizza", "frozen peas", "eiswürfel", "fischstäbchen", "frozen spinach",
    # household
    "spülmittel", "toilettenpapier", "waschmittel", "müllbeutel", "schwamm",
    # spices_seasoning
    "salz", "pfeffer", "paprikapulver", "oregano", "currypulver",
    # canned_jars
    "dosentomaten", "kichererbsen dose", "mais konserve", "rote bohnen", "sardinen in öl",
    "Holler Zwetschken Konfitüre", "Wild-Preiselbeeren", "Apfelmark", "Crème Noisette", 
]

results = []
for item in items:
    
    results.append({
    "original": item,
    "classified": classifier.classify(item)
    })

print(results)