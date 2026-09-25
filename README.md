# Codex five-hour window audit

Static, dependency-free GitHub Pages report of aggregate local Codex usage. The page contains **no prompts, responses, tool content, session IDs, or raw log records**.

## View locally

Open `index.html` in a browser, or serve this directory with `python3 -m http.server 8000` and visit `http://localhost:8000/`.

## Rebuild data

Run `python3 tools/build_data.py` on the machine with the Codex logs. This reads native Codex sessions from `~/.codex/sessions` and `~/.codex/archived_sessions`, plus the Omarchy agents price ledger. It writes only aggregate windows to `data.js`.

The build uses local `Europe/London` dates, merges reset timestamps within 120 seconds, and includes five-hour windows peaking at 80% or above. It also includes the 25 September GPT-6 Sol window as a separately marked preview if it is below 80%. Prices are standard short-context API equivalents, not charges. Before the local price ledger begins, GPT-5.5 and GPT-5.6 Sol rates are reconstructed from official launch pricing; GPT-5.5 cached-input continuity is an explicit assumption. Unpriced `codex-auto-review` usage makes four July dollar totals lower bounds.

## Publish to GitHub Pages

Create a public `Catylist0/codex-window-audit` repository, push this directory as its `main` branch, then set **Settings → Pages → Build and deployment → Deploy from a branch → main → /(root)**. The `.nojekyll` file lets GitHub Pages serve the static files directly.

The expected URL is `https://catylist0.github.io/codex-window-audit/` once GitHub Pages reports a successful deployment. The site will be public, including the aggregate dates, usage percentages, estimated dollars, and model shares in `data.js`.
