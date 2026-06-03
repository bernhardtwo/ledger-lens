# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-06-02

## Context
This is an AI-native portfolio project. Reviewers (human and agentic) should be
able to understand *why* the architecture is the way it is, not just *what* it
is. Decisions made only in chat history are invisible and unverifiable.

## Decision
We keep lightweight Architecture Decision Records (ADRs) in `docs/adr/`, one file
per significant decision, MADR-style (see `template.md`). Big decisions get an
ADR *before* implementation (`/new-adr`).

## Alternatives considered
- **No ADRs** — fastest, but loses the reasoning trail that is itself part of the
  portfolio signal.
- **A single design doc** — drifts out of date and mixes unrelated decisions.

## Consequences
- Positive: durable, reviewable rationale; demonstrates senior-level technical
  communication.
- Negative (accepted): small per-decision overhead.
