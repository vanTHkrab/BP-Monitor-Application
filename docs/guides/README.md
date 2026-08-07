---
title: Guides
description: Index of the how-to material — setup, run, deploy, and troubleshoot.
status: current
updated: 2026-08-07
owner: cross
---

# Guides

Task-shaped documentation. If you are asking "how do I…", the answer is here.
If you are asking "what is the contract" or "why is it like this", you want
[`docs/reference/`](../reference/) or [`docs/decisions/`](../decisions/).

| Guide | Read it when |
| --- | --- |
| [setup.md](./setup.md) | Fresh clone — install, configure, verify |
| [run.md](./run.md) | Day-to-day commands, and which check is the real ship gate |
| [deploy.md](./deploy.md) | Putting the backend on a host, TLS, and the access model |
| [push-notifications-setup.md](./push-notifications-setup.md) | Turning the already-built push code into actual delivery — Firebase, FCM V1, and the ways this config fails without saying so |
| [troubleshooting.md](./troubleshooting.md) | Something failed in a way that points at the wrong cause |

These guides own the how-to steps. Where a per-app README or
[`infra/README.md`](../../infra/README.md) covers the same ground, it links
here rather than keeping a copy — `infra/README.md` remains the reference for
Compose file structure, port tables, and per-service configuration reasoning.
