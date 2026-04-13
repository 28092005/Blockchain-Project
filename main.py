import sys
import os
import requests
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")

# Force explicit path to avoid encoding/cwd issues
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)
API_KEY = os.getenv("OPENROUTER_API_KEY")

if not API_KEY:
    raise ValueError("OPENROUTER_API_KEY not found in .env")

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

data = {
    "model": "openrouter/free",
    "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing simply."}
    ]
}

response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=data)
result = response.json()

if "choices" in result:
    print(result["choices"][0]["message"]["content"])
else:
    print("API Error:", result)
