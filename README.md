# CorVia Flask v2 — Premium Dark Medical UI
==========================================

## Design System

**Aesthetic:** Dark Medical Luxe — Bloomberg Terminal meets premium health clinic
**Display font:** Fraunces (optical-size serif — editorial, trustworthy)
**Body font:** Geist (clean, modern sans-serif)
**Mono font:** DM Mono (data, labels, metadata)
**Background:** Deep obsidian #080608 with 48px grid overlay
**Accent:** Surgical crimson #d32f2f with glow effects
**Cards:** Glass morphism on dark surfaces with inset highlights

## What's new vs v1

| Feature | v1 | v2 |
|---|---|---|
| Color scheme | Light white/red | Dark obsidian/crimson |
| Typography | Inter (generic) | Fraunces + Geist + DM Mono |
| Login page | Simple card | Split panel with brand stats |
| Background | Solid | Animated grid + radial glow |
| Topbar | Basic | Glassmorphism + pill nav |
| Hero section | Grid text | 3D orbital ring animation |
| Charts | Default Chart.js | Dark themed, custom colors |
| Map tiles | OSM default | Dark CartoDB tiles |
| Cards | Flat white | Dark glass with hover glow |
| Animations | Minimal | Staggered, ECG pulse, orb rings |
| Chat | Basic bubbles | Premium dark bubbles + markdown |
| Mobile | Basic responsive | Mobile-first with breakpoints |

## Setup (same as v1)

```bash
# 1. Install
pip install -r requirements.txt

# 2. Environment
cp .env.example .env
# Add GEMINI_API_KEY from https://aistudio.google.com

# 3. Model files (optional — fallback formula used if absent)
# Drop into models/: heart_risk_model.json, feature_columns.pkl, label_encoder_sex.pkl

# 4. Run
python app.py
# → http://localhost:5000
```

## Login
- admin / corvia123
- doctor / heart@2024
- patient / myhealth

## Disclaimer
Educational use only · Not medical advice
