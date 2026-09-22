# layaForWorkflows

**Workflow automation where every decision is a graph node, and the model runs in your browser.**

Each workflow is a diagram: diamonds are typed questions answered by a small decision model, boxes are automation steps, and the circles at the end say whether the case was handled automatically, sent to a person, or blocked. Type a support ticket, an alert, an insurance claim or an invoice, and watch the path light up with the model's probability on every branch. The model runs entirely in the tab through ONNX Runtime Web: no server, no API key, and nothing you type leaves the page.

**Live:** https://vishalmysore.github.io/layaForWorkflows/ · **Article with screenshots:** [docs/article.md](docs/article.md)

![Laya Workflows](docs/images/01-overview.png)

Model: [`VishalMysore/layaForWebTrained`](https://huggingface.co/VishalMysore/layaForWebTrained), which is [`convaiinnovations/laya-typed-decisions`](https://huggingface.co/convaiinnovations/laya-typed-decisions) (a 421M-parameter ModernBERT-large encoder fine-tuned for typed decisions) converted to ONNX and quantized by [layaForWeb](https://github.com/vishalmysore/layaForWeb).

## What's on the page

| View | What it shows |
|---|---|
| **Workflow** | The workflow as a DAG (Cytoscape + dagre). A run animates step by step. Each branch out of a decision is labelled with the probability mass the model put on it. Low-confidence escalations show as dashed amber edges. **Traffic** mode sizes edges by how often past runs took them. |
| **Decision graph** | The latest run with every decision expanded into all of its options. Node size is probability, and each option shows where it would have routed. |
| **Ontology** | An OWL/RDFS ontology of workflows and decisions. The **schema** (TBox) holds `Workflow`, `DecisionNode`, `TaskNode`, `OutcomeNode` (split into Automated, HumanReview and Blocked), `Question` (Choice, Score, YesNo), `Option`, `Case`, `Run`, `Decision` and `Effect`. The **facts** (ABox) are every workflow node, question and option, plus every run: a `Run` processes a `Case`, makes a chain of `Decision`s (`followedBy`), each of which `selected` an `Option` with a confidence, performs `Effect`s, and `endedAt` an outcome. Click any node to see its triples. Exports to **Turtle** and **JSON-LD**. |
| **Analytics** | Automation, review and block rates. A threshold sweep shows how the outcome mix shifts as you demand more confidence, computed by re-routing stored answers with no extra model calls. Also a strip plot of confidence per decision node, and outcomes per workflow. |
| **Editor** | The workflow as JSON. Validate it (missing routes, cycles, unreachable nodes, bad score ranges) and apply it. Create new workflows, import or export them, and optionally POST every decision record to a webhook. |

Built-in workflows (all example messages are synthetic):

- Support ticket triage
- AI agent action guardrail (fails closed)
- IT incident response
- Insurance claim intake (FNOL)
- Invoice approval (AP)
- Refund & returns
- Content moderation

## How a workflow is defined

A workflow is plain data: a DAG of three node types. `engine.js` runs it, and nothing else in the code is specific to a domain.

```js
{
  id: "refund-request", name: "Refund & returns", entity: "RefundRequest", start: "reason",
  nodes: {
    reason: {
      type: "decision", label: "Why a refund?",
      question: { type: "choice", instructions: "What is the main reason for the refund request?",
                  criteria: { damaged: "Item arrived damaged", not_received: "Order never arrived", ... } },
      routes: { damaged: "photo", not_received: "tracking", ... },
      onLowConfidence: "agent"                 // below the confidence threshold -> a person
    },
    old:    { type: "decision", question: { type: "noul", instructions: "The purchase was several months ago" },
              cutoff: 0.45,                    // p(true) needed to take the "true" branch
              routes: { true: "decline", false: "label" } },
    urgency: { type: "decision", question: { type: "score", instructions: "...", criteria: ["Low", "Medium", "High", "Critical"] },
              routes: { "0-1": "queue", "2+": "page" } },   // score routes are level ranges
    label:  { type: "task", channel: "email", label: "Send prepaid return label", template: "…{{answers.reason.selected}}…", next: "done" },
    done:   { type: "outcome", disposition: "auto", label: "Handled automatically" }   // auto | human | block
  }
}
```

- **decision**: one typed question to the model. `choice` routes by criterion key, `score` routes by level range on the rounded expected score (`"2"`, `"0-1"`, `"2+"`), and `noul` (yes/no) routes by `"true"`/`"false"`. If the **branch probability** is below the threshold (the global slider, or a per-node `minConfidence`), the run follows `onLowConfidence` instead. With no `onLowConfidence`, it takes the branch anyway and flags it. Yes/no nodes can set a `cutoff`, the p(true) needed to take the "true" branch (default 0.5). A low cutoff makes a fail-closed gate, for example "treat it as data-losing if p ≥ 0.3".
- **task**: an automation step with a templated side effect. The effects are simulated in the page, and the optional webhook receives the full decision record.
- **outcome**: a terminal disposition.

**Batch answering.** With this on (the default), all of a workflow's decision nodes are answered in one batched forward pass, so each run records the answer to every question, including those off the path it took. That lets the threshold slider re-route the current run instantly and powers the analytics sweep. Turn it off to ask only the questions on the path, one call per node.

**Why gate on branch probability.** The gate is the share of the model's probability that went down the chosen route: the top option's probability for a choice, the summed probability of the levels in a score range, and p or 1 − p for yes/no. Laya's own `confidence` (1 minus normalized entropy) is also recorded and shown. On a four-option question, though, it reads low even when the answer is clearly right (for example 0.48 for a correct "bug" at 78% probability), so a single threshold on it would send almost everything to a person. With branch probability, one slider means the same thing on every node: "act on your own only if at least X of the probability agrees".

**How the built-in questions were chosen.** Every question phrasing and cutoff was checked against this model's real outputs for the examples, and phrasings it handles poorly were replaced. For example, it is weak at comparing dollar amounts, so invoices are routed by what was bought rather than by amount tier. Yes/no probabilities from this checkpoint are compressed toward the middle by its calibration temperature (about 2.0), which is why some yes/no nodes set a `cutoff` below 0.5. At the default threshold of 0.5 the 37 examples end up 14 automated, 17 with a person and 6 blocked. The escalations fall on the ambiguous or misread cases: a money transfer read as a "reversible change" (p 0.43), a force-push (0.47), a four-month-old return (0.32). All numbers come from the quantized int8 build, so treat them as approximate.

## Before the model is downloaded

The int8 build is about 422 MB (int4: about 278 MB). It downloads once, straight from Hugging Face, and is kept in the browser's Cache Storage. Until you load it, the built-in examples play back `web/recorded.json`, which holds answers the same model gave for those exact messages. The page labels these runs as recorded. Your own text, or an edited workflow, needs the live model.

To regenerate `recorded.json` after changing the examples or questions, load the model in the page and run this in the console:

```js
copy(JSON.stringify(await __lw.record()))   // then paste into web/recorded.json
```

## Run locally

Requires Node 20+ and Python 3.

```
npm ci
npm test                          # engine, workflow library and ontology unit tests
node scripts/prepare_site.mjs     # assemble dist/ (page + vendored libraries, ~30 MB)
python serve.py                   # http://localhost:8000, with COOP/COEP headers for multithreaded WASM
```

Point the page at another copy of the model with `?modelBase=https://host/path/`. The host must send CORS headers.

## Deploy

`.github/workflows/deploy.yml` runs the unit tests, assembles `dist/` and publishes it to GitHub Pages on every push to `main` (Settings → Pages → Source: **GitHub Actions**). The model is not rebuilt or bundled. GitHub Pages can't send COOP/COEP headers, so a small service worker (`coi-sw.js`, scoped to this project's folder) adds them, which lets ONNX Runtime use several threads.

## Layout

| Path | What it is |
|---|---|
| `web/engine.js` | Workflow engine: validation (missing routes, cycles, orphans), execution, what-if replay. No DOM. |
| `web/workflows.js` | The built-in workflows and their example inputs |
| `web/ontology.js` | TBox/ABox builder, Turtle and JSON-LD export |
| `web/graphs.js` | Cytoscape views: workflow diagram, decision graph, ontology |
| `web/charts.js` | SVG charts for Analytics |
| `web/model.js` | Downloads, caches and starts the ONNX model |
| `web/laya-core.js` | Laya inference port (from layaForWeb, unchanged) |
| `web/main.js`, `index.html`, `styles.css` | The page |
| `web/recorded.json` | Recorded model answers for the built-in examples |
| `tests/engine.test.mjs` | Node unit tests |
| `scripts/prepare_site.mjs` | Assembles `dist/` |

## License

Apache License 2.0 (see `LICENSE`). The model is a modified derivative of Laya by ConvAI Innovations (Apache-2.0), built on ModernBERT-large by Answer.AI and LightOn. The page ships ONNX Runtime Web (MIT), Tokenizers.js (Apache-2.0), Cytoscape.js (MIT) and cytoscape-dagre (MIT). See `NOTICE.md` and `licenses/`. This is an unofficial project and is not affiliated with ConvAI Innovations.
