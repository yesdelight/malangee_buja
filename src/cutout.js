const MODEL = 'Xenova/detr-resnet-50-panoptic';
const BACKGROUND_LABELS = new Set([
  'wall', 'floor', 'ceiling', 'sky', 'road', 'grass', 'building', 'pavement', 'ground',
  'earth', 'rug', 'field', 'mountain', 'sea', 'water', 'river', 'sand', 'land', 'house',
  'bridge', 'streetlight', 'street lamp', 'sidewalk', 'path', 'step', 'staircase', 'stairway',
]);

let segmenterPromise;
let transformersPromise;

function loadTransformers() {
  transformersPromise ??= import('@huggingface/transformers');
  return transformersPromise;
}

async function getSegmenter(onProgress) {
  segmenterPromise ??= (async () => {
    const { pipeline } = await loadTransformers();
    if (navigator.gpu) {
      try {
        return await pipeline('image-segmentation', MODEL, { device: 'webgpu', dtype: 'q8', progress_callback: onProgress });
      } catch (error) {
        console.info('WebGPU is unavailable for segmentation; using WASM.', error);
      }
    }
    return pipeline('image-segmentation', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: onProgress });
  })().catch((error) => {
    segmenterPromise = undefined;
    throw error;
  });
  return segmenterPromise;
}

async function maskedBlob(image, mask) {
  const resizedMask = await mask.resize(image.width, image.height);
  const rgba = image.clone().rgba();
  // Keep a feathered edge from the model's confidence mask instead of hard thresholding.
  rgba.putAlpha(resizedMask);
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = rgba.width;
    canvas.height = rgba.height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('Canvas is unavailable'));
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode cutout')), 'image/png');
  });
}

async function readPhoto(file, RawImage) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Canvas is unavailable');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return RawImage.fromCanvas(canvas);
}

export async function findCutouts(file, onProgress = () => {}) {
  const { RawImage } = await loadTransformers();
  const original = await readPhoto(file, RawImage);
  const longestSide = Math.max(original.width, original.height);
  const image = longestSide > 960
    ? await original.resize(Math.round(original.width * 960 / longestSide), Math.round(original.height * 960 / longestSide))
    : original;
  const model = await getSegmenter(onProgress);
  const output = await model(image, { threshold: 0.45, mask_threshold: 0.42 });
  const ranked = [];

  for (const segment of output) {
    const label = String(segment.label || '대상').toLowerCase();
    if (BACKGROUND_LABELS.has(label)) continue;
    if (typeof segment.score === 'number' && segment.score < 0.3) continue;
    const mask = segment.mask;
    let visiblePixels = 0;
    for (let index = 0; index < mask.data.length; index += mask.channels) {
      if (mask.data[index] > 24) visiblePixels++;
    }
    const coverage = visiblePixels / (mask.width * mask.height);
    if (coverage < 0.008 || coverage > 0.88) continue;
    ranked.push({
      label: segment.label || '대상',
      score: segment.score ?? 0,
      coverage,
      mask,
    });
  }

  ranked.sort((a, b) => b.coverage - a.coverage);
  const candidates = [];
  for (const segment of ranked.slice(0, 6)) {
    candidates.push({
      label: segment.label,
      score: segment.score,
      coverage: segment.coverage,
      blob: await maskedBlob(original, segment.mask),
    });
  }
  // Keep a short, useful choice set and let users choose the main object.
  return candidates.slice(0, 8);
}
