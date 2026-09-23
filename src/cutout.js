const MODEL = 'Xenova/detr-resnet-50-panoptic';
const BACKGROUND_LABELS = new Set([
  'wall', 'floor', 'ceiling', 'sky', 'road', 'grass', 'building', 'pavement', 'ground',
  'earth', 'rug', 'field', 'mountain', 'sea', 'water', 'river', 'sand', 'land', 'house',
  'bridge', 'streetlight', 'street lamp', 'sidewalk', 'path', 'step', 'staircase', 'stairway',
  'banner', 'blanket', 'cardboard', 'counter', 'curtain', 'door-stuff', 'floor-wood',
  'gravel', 'mirror-stuff', 'net', 'platform', 'playingfield', 'railroad', 'roof', 'shelf',
  'snow', 'tent', 'towel', 'wall-brick', 'wall-concrete', 'wall-other', 'wall-panel',
  'wall-stone', 'wall-tile', 'wall-wood', 'water-other', 'window-blind', 'window-other',
  'tree-merged', 'fence-merged', 'ceiling-merged', 'sky-other-merged', 'cabinet-merged',
  'floor-other-merged', 'wall-other-merged', 'rug-merged', 'desk-stuff', 'door-merged',
]);

let segmenterPromise;
let transformersPromise;
let heicConverterPromise;
const loadHeicConverter = () => import('heic2any');

function loadTransformers() {
  transformersPromise ??= import('@huggingface/transformers');
  return transformersPromise;
}

async function getSegmenter(onProgress, localFilesOnly = false) {
  segmenterPromise ??= (async () => {
    const { pipeline } = await loadTransformers();
    if (navigator.gpu) {
      try {
        return await pipeline('image-segmentation', MODEL, { device: 'webgpu', dtype: 'q8', local_files_only: localFilesOnly, progress_callback: onProgress });
      } catch (error) {
        console.info('WebGPU is unavailable for segmentation; using WASM.', error);
      }
    }
    return pipeline('image-segmentation', MODEL, { device: 'wasm', dtype: 'q8', local_files_only: localFilesOnly, progress_callback: onProgress });
  })().catch((error) => {
    segmenterPromise = undefined;
    throw error;
  });
  return segmenterPromise;
}

async function maskedBlob(image, mask) {
  const resizedMask = await mask.resize(image.width, image.height);
  const rgba = image.clone().rgba();
  const alpha = resizedMask.channels === 1 ? resizedMask.data : resizedMask.data.filter((_, index) => index % resizedMask.channels === 0);
  for (let pixel = 0; pixel < rgba.width * rgba.height; pixel++) rgba.data[pixel * 4 + 3] = alpha[pixel];
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

export async function normalizePhoto(file) {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  let isHeic = /\.(heic|heif)$/.test(name) || type.includes('heic') || type.includes('heif');
  if (!isHeic) {
    const header = new TextDecoder().decode(await file.slice(0, 32).arrayBuffer());
    isHeic = header.includes('ftyp') && /hei[ cxs]|hev[ cx]|mif1|msf1/i.test(header);
  }
  if (!isHeic) return file;
  heicConverterPromise ??= loadHeicConverter().then((module) => module.default || module);
  const convert = await heicConverterPromise;
  let converted;
  try {
    converted = await convert({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  } catch (error) {
    const conversionError = new Error('HEIC_CONVERSION_FAILED');
    conversionError.cause = error;
    throw conversionError;
  }
  const jpeg = Array.isArray(converted) ? converted[0] : converted;
  if (!(jpeg instanceof Blob) || !jpeg.size) throw new Error('HEIC_CONVERSION_FAILED');
  return new File([jpeg], name.replace(/\.(heic|heif)$/i, '.jpg') || 'photo.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
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

function rankSegments(output, includeBackground = false) {
  const ranked = [];
  for (const segment of output || []) {
    const label = String(segment.label || '대상').toLowerCase();
    const isBackground = BACKGROUND_LABELS.has(label);
    if (isBackground && !includeBackground) continue;
    const mask = segment.mask;
    if (!mask?.data || !mask.width || !mask.height) continue;
    let visiblePixels = 0;
    const channels = Math.max(1, mask.channels || 1);
    for (let index = 0; index < mask.data.length; index += channels) {
      if (mask.data[index] > 16) visiblePixels++;
    }
    const coverage = visiblePixels / (mask.width * mask.height);
    // Keep small and unusual subjects. Only near-full-frame masks are likely to be backdrop.
    if (coverage < 0.001 || coverage > 0.995) continue;
    ranked.push({ label: segment.label || '대상', score: segment.score ?? 0, coverage, mask, isBackground });
  }
  ranked.sort((a, b) => Number(a.isBackground) - Number(b.isBackground) || b.score - a.score || b.coverage - a.coverage);
  return ranked;
}

export async function findCutouts(file, onProgress = () => {}) {
  const { RawImage } = await loadTransformers();
  const original = await readPhoto(file, RawImage);
  const longestSide = Math.max(original.width, original.height);
  const image = longestSide > 1280
    ? await original.resize(Math.round(original.width * 1280 / longestSide), Math.round(original.height * 1280 / longestSide))
    : original;
  const model = await getSegmenter(onProgress);
  let ranked = rankSegments(await model(image, { threshold: 0.32, mask_threshold: 0.32, overlap_mask_area_threshold: 0.9 }));
  // A permissive second pass catches small or lower-confidence objects that the first pass misses.
  if (!ranked.length) ranked = rankSegments(await model(image, { threshold: 0.18, mask_threshold: 0.2, overlap_mask_area_threshold: 0.95 }));
  // Some photos contain only a dominant panoptic segment; offer it instead of silently returning no result.
  if (!ranked.length) ranked = rankSegments(await model(image, { threshold: 0.12, mask_threshold: 0.16, overlap_mask_area_threshold: 1 }), true);
  const candidates = [];
  for (const segment of ranked.slice(0, 8)) {
    try {
      candidates.push({ label: segment.label, score: segment.score, coverage: segment.coverage, blob: await maskedBlob(original, segment.mask) });
    } catch (error) {
      console.warn(`Could not create cutout for ${segment.label}`, error);
    }
  }
  return candidates;
}

export async function prepareCutoutModel(onProgress = () => {}, localFilesOnly = false) {
  await getSegmenter(onProgress, localFilesOnly);
}
