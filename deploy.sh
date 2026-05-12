#!/bin/bash
# FestPlan — Push redesign to GitHub & trigger Vercel deploy
# Run this from the festplan-main/festplan-main directory

set -e

echo "🎪 FestPlan Deploy Script"
echo "========================="

# Clean up if .git already exists with issues
if [ -d ".git" ] && ! git status &>/dev/null; then
  echo "⚠  Removing corrupted .git directory..."
  rm -rf .git
fi

# Initialize fresh repo if needed
if [ ! -d ".git" ]; then
  echo "📦 Initializing git repo..."
  git init -b main
  git remote add origin https://github.com/LPStruiksma/festplan.git
fi

# Make sure supabase temp files are ignored
if ! grep -q "supabase/.temp" .gitignore 2>/dev/null; then
  echo "" >> .gitignore
  echo "supabase/.temp/" >> .gitignore
fi

# Stage everything
echo "📋 Staging files..."
git add -A

# Commit
echo "💾 Committing..."
git commit -m "Redesign frontend with Festival Noir aesthetic

Complete visual overhaul of the FestPlan UI:

- New design system (CSS custom properties, animations, grain texture overlay)
- Typography: Syne (display) + Outfit (body) via Google Fonts
- LoginPage: dramatic hero with ambient gradient orb, staggered reveals
- SetupPage: editorial card layouts, accent bars, hover micro-interactions
- SchedulePage: refined grid/list views, SVG icons, staggered list entries
- App: polished loading spinner
- Cleaned up legacy CSS files

All functionality preserved — only the visual layer was overhauled.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# Push (force since we're replacing history from zip download)
echo "🚀 Pushing to GitHub..."
git push -u origin main --force

echo ""
echo "✅ Done! Pushed to https://github.com/LPStruiksma/festplan"
echo "   Vercel should auto-deploy within ~1 minute."
