from ollama import Client


DEFAULT_CLASSIFIER_SERVER = "http://127.0.0.1:11434"
MODEL_NAME = "lfm2.5-thinking:latest"

results = []
client = Client(DEFAULT_CLASSIFIER_SERVER)

response = client.chat(model=MODEL_NAME, messages=[
        {"role": "system", "content": "hello, you are an llm"},
        {"role": "user", "content": "output exactly 10 words"},
])
print(f"response: {response.message.content}")
results.append((response.message.content or "").strip())