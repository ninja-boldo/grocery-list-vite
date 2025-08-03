import subprocess


def classify(sentence):
    prompt = f"""
        You are a classification assistant. Your task is to classify the following food product into one of 7 categories:

        1. sweets  
        2. spread(bread)  
        3. allday things (only eggs, milk and yoghurt)  
        4. fruits  
        5. greens (in this case tomatoes are greens)
        6. bbq stuff  
        7. other  

        You may think step-by-step **internally**, but your final output must be **only the classname**, nothing else.
        also directly prefix your answer with this:hslsjhflkjsfsklfjs

        Food product: "{sentence}"  
        Answer:
        """

    result = subprocess.run(
        ["ollama", "run", "qwen3:4b"],
        input=prompt.encode(),
        stdout=subprocess.PIPE,
    )

    output = result.stdout.decode()
    output = output.strip()
    _, end = start_end_substring(output, "hslsjhflkjsfsklfjs")

    return output[end:]


def start_end_substring(string, substring):
    """return start and end indices"""

    length_sub = len(substring)
    return string.find(substring), string.find(substring) + length_sub


print(classify("tomatoes"))
