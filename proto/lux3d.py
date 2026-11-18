#!/usr/bin/env python3
"""Minimal Aholo (international) API probe. Standard library only.

The API key is read from stdin (pipe it from ./keys.sh pipe AHOLO_API_KEY) and is never printed.

  ./keys.sh pipe AHOLO_API_KEY | python3 proto/lux3d.py balance
  ./keys.sh pipe AHOLO_API_KEY | python3 proto/lux3d.py quote /lux3d/v1/generate/text-to-3d/task/create '{"prompt":"wooden chest","version":"G1-Turbo"}'
  ./keys.sh pipe AHOLO_API_KEY | python3 proto/lux3d.py create /lux3d/v1/generate/text-to-3d/task/create '{...}'
  ./keys.sh pipe AHOLO_API_KEY | python3 proto/lux3d.py task <taskId>
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.aholo.ai/global"


def call(key, method, path, body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": key, "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(errors="replace"), e.code
    try:
        out = json.loads(raw)
    except ValueError:
        out = raw[:2000]
    return status, out


def main():
    key = sys.stdin.read().strip()
    if not key:
        sys.exit("no key on stdin")
    cmd, *rest = sys.argv[1:] or ["balance"]
    if cmd == "balance":
        status, out = call(key, "GET", "/lux3d/v1/account/balance", params={"source": 2})
    elif cmd == "quote":
        path, body = rest[0], json.loads(rest[1])
        s1, acct = call(key, "GET", "/lux3d/v1/account/balance", params={"source": 2})
        uid = (acct.get("d") or {}).get("uniqueId") if isinstance(acct, dict) else None
        item = {"endpoint": {"method": "POST", "path": path},
                "parameters": {"pathParameters": "{}", "queryParameters": "{}",
                               "body": json.dumps(body, separators=(",", ":"))}}
        status, out = call(key, "POST", "/lux3d/v1/pricing/openapi-quotes",
                           {"source": 2, "agentName": "claude-code", "uniqueId": uid, "items": {"1": item}})
    elif cmd == "create":
        status, out = call(key, "POST", rest[0], json.loads(rest[1]))
    elif cmd == "task":
        status, out = call(key, "GET", "/lux3d/v1/generate/task/get", params={"taskid": rest[0]})
    elif cmd == "get":
        status, out = call(key, "GET", rest[0])
    else:
        sys.exit("unknown command")
    print(status)
    print(json.dumps(out, indent=1, ensure_ascii=False)[:6000])


if __name__ == "__main__":
    main()
