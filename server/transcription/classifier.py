from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from langchain_ollama import ChatOllama
from typing import Literal


llm = ChatOllama(model="qwen3:1.7b")  

class Classification(BaseModel):
    category: Literal["milch", "apfel", "ball", "honig", "bananen", "birnen", "unknown"] = Field(
        description="The exact category from the available classes that best matches the text"
    )
    confidence: float = Field(
        description="Confidence score between 0.0 and 1.0",
        ge=0.0,
        le=1.0
    )

# More explicit prompt
tagging_prompt = ChatPromptTemplate.from_template(
    """
You are a text classifier. Your job is to find which category from the available classes best matches the input text.

Available categories: {classes}

Input text: "{input}"

Look for keywords in the input text that match the available categories. 
If "milch" appears in the text, choose "milch".
If "apfel" appears in the text, choose "apfel".
And so on...

If no clear match is found, use "unknown" and set confidence low.

Return your classification with a confidence score.
"""
)

# Alternative: Even more explicit prompt
explicit_prompt = ChatPromptTemplate.from_template(
    """
Find the food item mentioned in this text: "{input}"

Choose EXACTLY ONE from these options: {classes}

Examples:
- "ich will milch" → category: "milch"
- "ich brauche äpfel" → category: "apfel" 
- "kaufe bananen" → category: "bananen"

Your response should identify which food item from the list appears in the input text.
"""
)

def main_test():
    # Try both approaches
    structured_llm = llm.with_structured_output(Classification)
    chain1 = tagging_prompt | structured_llm
    chain2 = explicit_prompt | structured_llm

    inp = "ich will heute milch"
    classes = "milch, apfel, ball, honig, bananen, birnen"

    print("=== Approach 1: Detailed instructions ===")
    try:
        response1 = chain1.invoke({"input": inp, "classes": classes})
        print("Result:", response1.model_dump())
    except Exception as e:
        print("Error:", e)

    print("\n=== Approach 2: Simple examples ===")
    try:
        response2 = chain2.invoke({"input": inp, "classes": classes})
        print("Result:", response2.model_dump())
    except Exception as e:
        print("Error:", e)

    # Test with more examples
    test_cases = [
        "ich will heute milch",
        "brauche äpfel für kuchen", 
        "honig ist lecker",
        "der ball ist rot"  # non-food item to test
    ]

    print("\n=== Testing multiple inputs ===")
    for test_input in test_cases:
        try:
            result = chain2.invoke({"input": test_input, "classes": classes})
            print(f"Input: '{test_input}' → {result.model_dump()}")
        except Exception as e:
            print(f"Input: '{test_input}' → Error: {e}")

def classifiy(input, classes):
    structured_llm = llm.with_structured_output(Classification)
    #chain = tagging_prompt | structured_llm
    chain = explicit_prompt | structured_llm
    
    result = chain.invoke({"input": input, "classes": classes})
    return result.model_dump()

main_test()