# Notice

layaForWorkflows is an unofficial project built on a browser port of the Laya typed-decisions checkpoint. It is not affiliated with or endorsed by ConvAI Innovations, Microsoft, Hugging Face, Answer.AI, LightOn or the Cytoscape Consortium.

## This project

The workflow engine, ontology, graph views and page in this repository are Copyright 2026 vishalmysore and licensed under the Apache License, Version 2.0 (see `LICENSE`).

## The model

The page loads [`VishalMysore/layaForWebTrained`](https://huggingface.co/VishalMysore/layaForWebTrained) at runtime. That is a modified derivative of [`convaiinnovations/laya-typed-decisions`](https://huggingface.co/convaiinnovations/laya-typed-decisions) (Copyright ConvAI Innovations, Apache-2.0), exported to ONNX and quantized by the [layaForWeb](https://github.com/vishalmysore/layaForWeb) project. Laya is built on ModernBERT-large by Answer.AI and LightOn (Apache-2.0). The model files are not part of this repository; their own `LICENSE` and `NOTICE.md` are in the model repository.

`web/laya-core.js` is copied unchanged from layaForWeb (as of commit 6e67de8, which clamps the calibration temperature to [0.5, 5.0] like upstream `clamp_temperature`; see layaForWeb issue #1). It is a JavaScript port of the Python `laya/common.py` (`build_sequence`) and `laya/agent.py` (`system_one`) from https://github.com/NandhaKishorM/laya (Apache-2.0).

`web/recorded.json` holds answers that the same model produced for the built-in example messages, so the page can show them before the model is downloaded. All example messages are synthetic.

## Third-party software shipped with the page (`vendor/`)

- **ONNX Runtime Web** (`onnxruntime-web` 1.30.0): Copyright (c) Microsoft Corporation, MIT License. `licenses/onnxruntime-LICENSE.txt`; notices for components inside the WebAssembly binary are in `licenses/onnxruntime-ThirdPartyNotices.txt`.
- **Tokenizers.js** (`@huggingface/tokenizers` 0.2.0): Hugging Face, Apache License 2.0. `licenses/tokenizers.js-LICENSE.txt`.
- **Cytoscape.js** (`cytoscape` 3.34.3): Copyright (c) The Cytoscape Consortium, MIT License. `licenses/cytoscape-LICENSE.txt`.
- **cytoscape-dagre** (`cytoscape-dagre` 4.0.1, which bundles dagre and graphlib by Chris Pettitt, MIT): MIT License. `licenses/cytoscape-dagre-LICENSE.txt`.
