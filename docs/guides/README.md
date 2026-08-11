---
title: Guides
description: Index of the how-to material — setup, run, deploy, and troubleshoot.
status: current
updated: 2026-08-11
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
| [deploy.md](./deploy.md) | Putting the backend on a host, TLS, and the access model — **and which of the two runtimes you are on** (Podman Quadlet on EC2 is production; Docker Compose is development) |
| [push-notifications-setup.md](./push-notifications-setup.md) | Turning the already-built push code into actual delivery — Firebase, FCM V1, and the ways this config fails without saying so |
| [email-delivery-setup.md](./email-delivery-setup.md) | Same shape, for email — the OTP and password-reset screens are built and the gateway sends nothing until a provider is wired in |
| [troubleshooting.md](./troubleshooting.md) | Something failed in a way that points at the wrong cause |

These guides own the how-to steps. Where a per-app README or
[`infra/README.md`](../../infra/README.md) covers the same ground, it links
here rather than keeping a copy — `infra/README.md` remains the reference for
Compose file structure, port tables, and per-service configuration reasoning,
and [`infra/podman/README.md`](../../infra/podman/README.md) is the equivalent
reference for the production Podman Quadlet runtime.
