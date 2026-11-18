---
trigger: always_on
description: Load PricePulse project baseline from README.md and targeted SRS.md sections without exhausting context.
---

# PricePulse Project Baseline Rule

When starting a new engineering task in the PricePulse workspace:

1. **Load Architecture & Setup Baseline:** Read `README.md` first (unless the request is purely conversational) to align with the current project structure, tech stack, ports, and verification commands.
2. **Target `SRS.md` Economically:** Do **not** read the entire `SRS.md` file up front unless explicitly asked for a full-document review. Instead, search `SRS.md` (e.g., `rg -n "REQ-|<topic>" SRS.md`) and read only the relevant requirement sections and Revision History.
3. **Synchronize Changes:** Whenever implementing features, fixing bugs, or altering architecture, update the corresponding `REQ-*` sections and Revision History in `SRS.md` (per `RULE-SRS`).
