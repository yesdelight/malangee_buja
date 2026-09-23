# 말랑이 부자

사진 속 대상을 오려 화면에서 눌러보고, 늘리고, 던지는 설치형 웹 앱(PWA) MVP.

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

The static production bundle is written to `dist/` and can be hosted by any static site host. Use HTTPS for camera access, install prompts, and device APIs.

## MVP behavior

- Runs as a mobile-first PWA and stores cutouts and playground positions in IndexedDB on the device.
- Runs object segmentation in the browser. The selected image is not uploaded to an app server.
- Shows segmentation candidates before adding them. The current panoptic model can miss unusual objects and the first use downloads its model files from Hugging Face.
- Uses a subdivided Three.js mesh with a domed surface, localized vertex deformation, spring return, gravity, edge bounce, and toy-to-toy collisions.
- Generates short squish sounds with Web Audio and requests vibration through the browser API where supported. iOS Safari does not expose the same vibration API as Android browsers.
- Shares a screenshot of the playground using the operating system share sheet when available; otherwise it downloads a PNG.

## Main modules

- `src/main.js`: app flow, object picker, local persistence, share, and controls.
- `src/cutout.js`: in-browser object segmentation and transparent cutout generation.
- `src/scene.js`: Three.js playground, mesh deformation, touch input, and collisions.
- `src/feel.js`: sound, vibration, and squish preset behavior.
- `src/storage.js`: IndexedDB storage.

## Model and product limitations

The segmentation pipeline uses `Xenova/detr-resnet-50-panoptic`, a browser-compatible ONNX export of Meta's DETR panoptic segmentation model. The upstream model is published under Apache-2.0; see the [upstream model card](https://huggingface.co/facebook/detr-resnet-50-panoptic). The model is an MVP choice: unusual subjects, small details, hair/fur edges, and multiple objects with similar shapes need stronger matting and a manual add/remove brush before production. Review the full model, training data, and redistribution terms for the intended commercial use before launch.

The displayed object keeps the cutout's silhouette and uses a lit, bulged mesh to create a tactile 2.5D impression. It is not a reconstructed photorealistic 3D asset. Fine-grained local pulling (e.g. only one ear) and true volumetric deformation remain a later physics milestone.

Photos and cutouts are stored only in this browser profile. Clearing site data removes them; there is no account or cloud sync yet.
