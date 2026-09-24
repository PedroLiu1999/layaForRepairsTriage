# Notice

layaForRepairsTriage is an unofficial project built on a browser port of the Laya typed-decisions checkpoint. It is not affiliated with or endorsed by ConvAI Innovations, the layaForWorkflows author (Vishal Mysore), any social landlord, any housing association, any local authority, any government body (including the UK Ministry of Housing, Communities & Local Government or the Regulator of Social Housing), Microsoft, Hugging Face, Answer.AI, LightOn or the Cytoscape Consortium.

## Derivative Work

This repository (`layaForRepairsTriage`) is a modified derivative of [`layaForWorkflows`](https://github.com/vishalmysore/layaForWorkflows) by Vishal Mysore (licensed under the Apache License, Version 2.0).

Modifications and additions in this derivative:
- Replaced domain workflows in `web/workflows.js` with England social housing repairs triage (`awaab-triage`) structured around Awaab's Law.
- Added deterministic workflow safety linter in `web/safety.js`.
- Added deterministic intake pre-checks in `web/intake.js`.
- Added deterministic statutory compliance engine in `web/compliance.js`.
- Added statutory rules dataset in `web/rules/awaab-england.js`.
- Added England & Wales bank holidays snapshot in `web/bankholidays.js`.
- Added append-only case management store and event ledger in `web/cases.js`.
- Added draft tenant letter templates in `web/letters.js`.
- Extended ontology classes and JSON-LD audit pack export in `web/ontology.js`.
- Extended UI with persistent disclaimer banner, intake panel, Cases tab, case detail modal, demo clock, and analytics in `web/index.html`, `web/main.js`, and `web/styles.css`.
- Added evaluation dataset (`eval/reports.jsonl`), evaluation runner (`eval/run_eval.mjs`), and answer recorder (`scripts/record_answers.py`).
- Added comprehensive unit tests in `tests/compliance.test.mjs`, `tests/safety.test.mjs`, `tests/intake.test.mjs`, and `tests/cases.test.mjs`.

## Upstream Project

The original workflow engine, ontology, graph views and page from layaForWorkflows are Copyright 2026 vishalmysore and licensed under the Apache License, Version 2.0 (see `LICENSE`).

## The model

The page loads [`VishalMysore/layaForWebTrained`](https://huggingface.co/VishalMysore/layaForWebTrained) at runtime. That is a modified derivative of [`convaiinnovations/laya-typed-decisions`](https://huggingface.co/convaiinnovations/laya-typed-decisions) (Copyright ConvAI Innovations, Apache-2.0), exported to ONNX and quantized by the [layaForWeb](https://github.com/vishalmysore/layaForWeb) project. Laya is built on ModernBERT-large by Answer.AI and LightOn (Apache-2.0). The model files are not part of this repository; their own `LICENSE` and `NOTICE.md` are in the model repository.

`web/laya-core.js` is copied unchanged from layaForWeb (as of commit 6e67de8, which clamps the calibration temperature to [0.5, 5.0] like upstream `clamp_temperature`; see layaForWeb issue #1). It is a JavaScript port of the Python `laya/common.py` (`build_sequence`) and `laya/agent.py` (`system_one`) from https://github.com/NandhaKishorM/laya (Apache-2.0).

`web/recorded.json` holds answers that the same model produced for the built-in example messages, so the page can show them before the model is downloaded. All example messages are synthetic.

## Third-party software shipped with the page (`vendor/`)

- **ONNX Runtime Web** (`onnxruntime-web` 1.30.0): Copyright (c) Microsoft Corporation, MIT License. `licenses/onnxruntime-LICENSE.txt`; notices for components inside the WebAssembly binary are in `licenses/onnxruntime-ThirdPartyNotices.txt`.
- **Tokenizers.js** (`@huggingface/tokenizers` 0.2.0): Hugging Face, Apache License 2.0. `licenses/tokenizers.js-LICENSE.txt`.
- **Cytoscape.js** (`cytoscape` 3.34.3): Copyright (c) The Cytoscape Consortium, MIT License. `licenses/cytoscape-LICENSE.txt`.
- **cytoscape-dagre** (`cytoscape-dagre` 4.0.1, which bundles dagre and graphlib by Chris Pettitt, MIT): MIT License. `licenses/cytoscape-dagre-LICENSE.txt`.
