"""Capture the screenshots used in docs/article.md.

    npm ci && node scripts/prepare_site.mjs
    python serve.py 5191            # in another terminal (or any server for dist/)
    pip install playwright && python -m playwright install chromium
    python scripts/capture_screenshots.py [--base http://localhost:5191/] [--no-model]

Drives the real page in headless Chromium. Most shots use the recorded answers (no download);
the live-model shots load the 422 MB model once into a persistent profile under .cache/.
"""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
OUT.mkdir(parents=True, exist_ok=True)
args = sys.argv[1:]
BASE = args[args.index("--base") + 1] if "--base" in args else "http://localhost:5191/"
WITH_MODEL = "--no-model" not in args
# Optional: an existing Chrome/Chromium build (e.g. when the Playwright-pinned one is not installed)
CHROME = args[args.index("--chrome") + 1] if "--chrome" in args else None


def shot(page, name, selector=None, full=False):
    path = OUT / f"{name}.png"
    if selector:
        page.locator(selector).first.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=full)
    print("saved", path.relative_to(ROOT))


def wait_idle(page, timeout=90_000):
    page.wait_for_function("() => document.getElementById('runBtn') && !document.getElementById('runBtn').disabled", timeout=timeout)
    page.wait_for_timeout(700)


def open_wf(page, wf, fresh=False):
    page.goto(f"{BASE}?wf={wf}")
    page.wait_for_function("() => window.__lw && window.__lw.state")
    if fresh:
        page.evaluate("() => { Object.keys(localStorage).filter(k => k.startsWith('lw.')).forEach(k => localStorage.removeItem(k)); }")
        page.goto(f"{BASE}?wf={wf}")
        page.wait_for_function("() => window.__lw && window.__lw.state")
    page.wait_for_function("() => window.__lw.state.recorded !== null")
    page.wait_for_timeout(600)


def tab(page, name):
    page.click(f".tabs button[data-tab={name}]")
    page.wait_for_timeout(1200)


def run_example(page, i):
    page.locator("#examples button").nth(i).click()
    page.click("#runBtn")
    wait_idle(page)


def run_all(page):
    page.click("#runAllBtn")
    page.wait_for_function("() => /Ran \\d/.test(document.getElementById('runHint').textContent)", timeout=120_000)
    page.wait_for_timeout(800)


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(ROOT / ".cache" / "chromium-profile"), headless=True, executable_path=CHROME,
        viewport={"width": 1440, "height": 960}, device_scale_factor=1.25, color_scheme="light",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.on("pageerror", lambda e: print("PAGE ERROR:", e))

    # 1. Hero: support triage, the urgent crash ticket
    open_wf(page, "support-triage", fresh=True)
    tab(page, "diagram")
    run_example(page, 0)
    shot(page, "01-overview")

    # 2. Workflow diagram close-up with the lit path (incident response, checkout outage)
    open_wf(page, "incident-response")
    run_example(page, 0)
    shot(page, "02-workflow-diagram", ".stage")
    shot(page, "03-result-trace", "#resultCard")

    # 3. Low-confidence escalation (agent guardrail, force-push)
    open_wf(page, "agent-guardrail")
    run_example(page, 5)
    shot(page, "04-guardrail-escalation", ".layout")

    # 4. Decision graph (refund: damaged mug with photos -> two decisions)
    open_wf(page, "refund-request")
    tab(page, "diagram")
    run_example(page, 0)
    tab(page, "tree")
    shot(page, "05-decision-graph", ".stage")

    # 5. What-if: refund at 0.50 vs 0.70 without calling the model
    open_wf(page, "refund-request")
    tab(page, "diagram")
    run_example(page, 0)
    shot(page, "06-whatif-050", ".layout")
    page.evaluate("() => { const t = document.getElementById('thresh'); t.value = 0.7; t.dispatchEvent(new Event('input')); }")
    page.wait_for_timeout(900)
    shot(page, "07-whatif-070", ".layout")
    page.evaluate("() => { const t = document.getElementById('thresh'); t.value = 0.5; t.dispatchEvent(new Event('input')); }")

    # 6. Run every example of every workflow, for traffic / ontology / analytics
    for wf in ["support-triage", "agent-guardrail", "incident-response", "insurance-claim", "invoice-approval", "refund-request", "content-moderation"]:
        open_wf(page, wf)
        tab(page, "diagram")
        run_all(page)

    open_wf(page, "agent-guardrail")
    tab(page, "diagram")
    page.check("#traffic")
    page.wait_for_timeout(900)
    shot(page, "08-traffic", ".stage")
    page.uncheck("#traffic")

    # 7. Ontology: decisions view with a decision selected, then the schema
    tab(page, "ontology")
    page.select_option("#ontoView", "decisions")
    page.wait_for_timeout(1500)
    page.evaluate("""() => { const cy = window.__lw.state.cy.onto; const n = cy.nodes().filter(n => n.id().startsWith('run_')).last(); n.select(); n.emit('tap'); }""")
    page.wait_for_timeout(700)
    shot(page, "09-ontology-decisions", ".stage")
    page.select_option("#ontoView", "schema")
    page.wait_for_timeout(1500)
    page.evaluate("() => { const cy = window.__lw.state.cy.onto; const n = cy.$id('C:Decision'); n.select(); n.emit('tap'); }")
    page.wait_for_timeout(700)
    shot(page, "10-ontology-schema", ".stage")
    page.select_option("#ontoView", "workflow")
    page.wait_for_timeout(1500)
    shot(page, "11-ontology-workflow", ".stage")

    # 8. Analytics
    open_wf(page, "refund-request")
    tab(page, "analytics")
    page.wait_for_timeout(2500)
    shot(page, "12-analytics", ".stage")

    # 9. Editor with a validation error
    tab(page, "editor")
    page.evaluate("""() => { const ed = document.getElementById('editor'); const wf = JSON.parse(ed.value);
        wf.nodes.reason.routes.damaged = 'nowhere'; delete wf.nodes.old.routes.true; ed.value = JSON.stringify(wf, null, 2);
        document.getElementById('applyBtn').click(); ed.scrollTop = 0; }""")
    page.wait_for_timeout(500)
    shot(page, "13-editor-validation", ".stage")
    page.evaluate("() => { document.getElementById('resetBtn').click(); }")

    # 10. Dark mode and phone width
    dark = ctx.new_page()
    dark.emulate_media(color_scheme="dark")
    open_wf(dark, "content-moderation")
    tab(dark, "diagram")
    run_example(dark, 3)
    shot(dark, "14-dark-mode")
    dark.set_viewport_size({"width": 390, "height": 844})
    dark.goto(f"{BASE}?wf=content-moderation")
    dark.wait_for_timeout(2500)
    shot(dark, "15-mobile", full=False)
    dark.close()

    # 11. Live model: load it, run text that is NOT one of the examples
    if WITH_MODEL:
        open_wf(page, "refund-request")
        tab(page, "diagram")
        page.click("#loadBtn")
        page.wait_for_function("() => window.__lw.ready", timeout=600_000)
        page.fill("#message", "The toaster I got two weeks ago stopped heating after three days. I have a photo of the burnt-out element.")
        page.dispatch_event("#message", "input")
        page.click("#runBtn")
        wait_idle(page)
        shot(page, "16-live-model")
        shot(page, "17-model-card", "#modelCard")

    ctx.close()
print("done")
