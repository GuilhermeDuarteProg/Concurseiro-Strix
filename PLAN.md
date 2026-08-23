# Plan: Concurseiro Strix

## Overview
Single-page SaaS-style study platform for Brazilian public exam ("concurso") preparation. Dark-mode-first, professional UI with question filtering, resolution interface, performance dashboard, and error notebook.

## Design Intent
```
Tone: "Dark cinematic SaaS — professional, elegant, study-focused"
Fonts: "Inter 300/400/600/700 (body) + JetBrains Mono 400 (code/metadata)"
Palette: "#0a0e17 #1a1f2e #e2e8f0 #7c3aed" — deep navy bg, surface, light text, purple accent
Layout signature: "Full-width sticky header, card-based content, sidebar filter panel on question bank"
Memorable element: "Purple glow accent on interactive elements with smooth 0.2s transitions"
```

## Pages / Views (all in index.html via JS tabs)
1. **Início** — Welcome hero + quick stats + "Gerar Simulado Rápido" CTA
2. **Banco de Questões** — Filter sidebar + question list + resolution card
3. **Simulados** — Simulado config + start + results
4. **Desempenho** — Stats cards + per-subject bar chart
5. **Caderno de Erros** — Saved wrong/favorited questions

## Tech Choices
- CSS: Vanilla CSS with custom properties (no framework)
- Icons: Inline SVG (feather-style)
- Fonts: Inter (body), JetBrains Mono (tags/metadata) via Google Fonts
- Charts: Canvas-based bar chart (vanilla JS)
- Storage: localStorage for theme, performance data, error notebook

## Execution Order
1. PLAN.md + project scaffolding
2. index.html — complete structure (header, all tab views, question modal)
3. styles/style.css — complete dark-first responsive styling
4. scripts/main.js — all interactivity, state management, chart rendering
5. Build verification