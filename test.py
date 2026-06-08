import requests
import sys
import json

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
API_KEY = sys.argv[2] if len(sys.argv) > 2 else "sk-test-key"
QUESTION = sys.argv[3] if len(sys.argv) > 3 else "Say hello in 3 languages"

if not BASE.endswith("/v1"):
    BASE = BASE.rstrip("/") + "/api/v1"

URL = f"{BASE.rstrip('/')}/chat/completions"

payload = {
    "messages": [{"role": "user", "content": QUESTION}],
    "temperature": 0.7,
    "max_tokens": 500,
    "stream": True,
}

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

print(f"POST {URL}")
print(f"Key: {API_KEY[:12]}...")
print()

response = requests.post(URL, json=payload, headers=headers, stream=True)

print(f"Status: {response.status_code}")
print()

if response.status_code == 200:
    print("Reply: ", end="", flush=True)
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("data: "):
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                print(content, end="", flush=True)
            except json.JSONDecodeError:
                pass
    print()
    print("\nDone.")
else:
    print("Error:", response.text)
