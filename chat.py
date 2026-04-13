import sys
import os
import requests
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

API_KEY = os.getenv("OPENROUTER_API_KEY")
headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

conversation = [
    {"role": "system", "content": "You are a helpful assistant."}
]

print("=" * 50)
print("  OpenRouter Chat (model: openrouter/free)")
print("  Type 'exit' or 'quit' to stop")
print("=" * 50)

while True:
    user_input = input("\nYou: ").strip()
    if not user_input:
        continue
    if user_input.lower() in ("exit", "quit"):
        print("Goodbye!")
        break

    conversation.append({"role": "user", "content": user_input})

    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json={"model": "openrouter/free", "messages": conversation},
            timeout=30
        )
        result = response.json()

        if "choices" in result:
            reply = result["choices"][0]["message"]["content"]
            conversation.append({"role": "assistant", "content": reply})
            print(f"\nAI: {reply}")
        else:
            error = result.get("error", {}).get("message", str(result))
            print(f"\n[Error] {error}")
            # Remove the last user message so conversation stays clean
            conversation.pop()

    except Exception as e:
        print(f"\n[Error] {e}")
        conversation.pop()
