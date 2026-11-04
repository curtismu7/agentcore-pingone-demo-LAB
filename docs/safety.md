# Safety

- Loopback bind only (`APD_BIND` is the explicit opt-in the container uses); the compose file publishes `127.0.0.1` only (a test pins it).
- Host header must be a loopback name; writes must be same-origin (no environment variable adds another origin).
- Netguard blocks every outbound connection (fetch, socket, DNS, UDP send and UDP connect) with a self-test, and a test asserts zero attempts.
- Settings come from the one shared file `~/Development/.env` (or `STANDALONE_ENV`), parsed with `util.parseEnv`; read-only, and no value is ever printed or returned. There is no per-app `.env` loader and no bare `MODE`.
- Modes are rule 19: `POST /api/mode` with exactly `{source}` switches at runtime; `GET /api/info` carries `realAvailable` and the how-to. Real is offered but always 409s in this build: the Real engine (live AgentCore Runtime + PingOne tenant) is owner-built and not wired, and `APD_REAL_ENGINE` plus the PingOne worker settings gate the offer. The header Real button is disabled with the same message.
- `POST /api/evaluate` accepts custom JSON but bounds it: body 8 KB, depth 6, 200 claims, 20 array items, 512-character values, 8 required claims, path shape checked by a fixed regex. Walks are iterative; there is no `eval`, `Function` or `vm`. Claim values are rendered as text only.
- Tokens are MOCK-ISSUED by this app and shown raw for education; there is no real credential, signature or key anywhere. No EC keygen is used.
- Story, posture and release-reading text is data; hosts end in `.example`; ARNs use the obviously fake account id 000000000000.
- No tenant, credential or customer identifier ships. `customer.config.json` only sets four display strings and is git-ignored.
