import os
import requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)
API_KEY = os.getenv("OPENROUTER_API_KEY")
headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# All free models from the account
models = [
    "openrouter/free",
    "liquid/lfm-2.5-1.2b-instruct:free",
    "liquid/lfm-2.5-1.2b-thinking:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "openai/gpt-oss-20b:free",
    "openai/gpt-oss-120b:free",
    "arcee-ai/trinity-large-preview:free",
    "google/gemma-3n-e2b-it:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "z-ai/glm-4.5-air:free",
]

for model in models:
    data = {"model": model, "messages": [{"role": "user", "content": "Say hi."}]}
    try:
        r = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=data, timeout=15)
        j = r.json()
        if "choices" in j:
            text = j["choices"][0]["message"]["content"][:60]
            print(f"[OK]   {model}")
            print(f"       -> {text}")
            break  # Stop at first working model
        else:
            code = j.get("error", {}).get("code", "?")
            msg = j.get("error", {}).get("message", "?")[:60]
            print(f"[{code}] {model}: {msg}")
    except Exception as e:
        print(f"[ERR]  {model}: {e}")
