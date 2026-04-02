#!/usr/bin/env python3
"""
Test script for Qoder OpenAI Proxy.
Tests all endpoints with the 'lite' model.

Usage:
    python test-proxy.py

If PROXY_API_KEY is set in your environment (or .env), it will be picked up automatically.
"""

import os
from openai import OpenAI

# Read API key from environment so this works regardless of PROXY_API_KEY value
api_key = os.environ.get("PROXY_API_KEY", "test-api-key")

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key=api_key,
)

print("=" * 60)
print("Testing Qoder OpenAI Proxy")
print("=" * 60)

# Test 1: List models
print("\n1. Testing /v1/models endpoint...")
try:
    models = client.models.list()
    print(f"✓ Available models: {[m.id for m in models.data]}")
except Exception as e:
    print(f"✗ Error: {e}")

# Test 2: Non-streaming chat completion
print("\n2. Testing non-streaming chat completion...")
try:
    response = client.chat.completions.create(
        model="lite",
        messages=[{"role": "user", "content": "Hello! Please introduce yourself in 2 sentences."}],
    )
    print(f"✓ Response: {response.choices[0].message.content[:200]}...")
except Exception as e:
    print(f"✗ Error: {e}")

# Test 3: Streaming chat completion
print("\n3. Testing streaming chat completion...")
try:
    stream = client.chat.completions.create(
        model="lite",
        messages=[{"role": "user", "content": "Write a haiku about coding (5-7-5 syllables)."}],
        stream=True,
    )
    print("✓ Stream response: ", end="", flush=True)
    for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)
    print("\n")
except Exception as e:
    print(f"✗ Error: {e}")

# Test 4: System message + multi-turn
print("\n4. Testing system message and conversation context...")
try:
    response = client.chat.completions.create(
        model="lite",
        messages=[
            {"role": "system", "content": "You are a helpful programming assistant. Be concise."},
            {"role": "user", "content": "What is async/await in JavaScript?"},
        ],
    )
    print(f"✓ Response: {response.choices[0].message.content[:200]}...")
except Exception as e:
    print(f"✗ Error: {e}")

# Test 5: Health check
print("\n5. Testing /health endpoint...")
try:
    import urllib.request, json as _json
    with urllib.request.urlopen("http://localhost:3000/health", timeout=5) as r:
        health = _json.loads(r.read())
        print(f"✓ Health: {health}")
except Exception as e:
    print(f"✗ Error: {e}")

print("\n" + "=" * 60)
print("All tests completed!")
print("=" * 60)
