import { SquishyScene } from './scene.js';
import { findCutouts } from './cutout.js';
import { toyStore } from './storage.js';
import { getPresets, isSoundEnabled, toggleSound } from './feel.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#scene');
const input = $('#photo-input');
const sheet = $('#selection-sheet');
const list = $('#candidate-list');
const countLabel = $('#count-label');
const emptyState = $('#empty-state');
const dock = $('#object-dock');
const statusPill = $('#status-pill');
const presets = getPresets();
let records = new Map();
let activeCandidates = [];
let selectedCandidates = new Set();
let pendingFiles = [];
let currentFileName = '';
let statusTimer;
let saving = Promise.resolve();

const appScene = new SquishyScene(canvas, {
  onSelect: updateSelection,
  onChange: (item, quiet = false) => persistItem(item, quiet),
});

function toast(message, duration = 2200) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(element.hideTimer);
  element.hideTimer = setTimeout(() => element.classList.remove('visible'), duration);
}

function setStatus(message, busy = false) {
  statusPill.textContent = message;
  statusPill.classList.toggle('visible', Boolean(message));
  statusPill.classList.toggle('busy', busy);
  clearTimeout(statusTimer);
  if (message && !busy) statusTimer = setTimeout(() => statusPill.classList.remove('visible'), 2400);
}

function setCount() {
  const number = records.size;
  countLabel.textContent = `말랑이 ${number}개`;
  emptyState.classList.toggle('hidden', number > 0);
}

function updateSelection(item) {
  dock.classList.toggle('visible', Boolean(item));
  if (!item) return;
  const preset = presets.find((entry) => entry.id === item.preset) || presets[0];
  $('#material-label').textContent = preset.label;
  $('#sound-label').textContent = isSoundEnabled() ? '소리 켬' : '소리 끔';
  $('#sound-button').classList.toggle('muted', !isSoundEnabled());
}

function persistItem(item, quiet = false) {
  if (!item?.blob) return;
  const saved = {
    id: item.id,
    name: item.name,
    blob: item.blob,
    x: item.group.position.x,
    y: item.group.position.y,
    preset: item.preset,
    updatedAt: Date.now(),
  };
  records.set(saved.id, saved);
  setCount();
  saving = saving.then(() => toyStore.put(saved)).then(() => {
    $('#save-state').textContent = '저장됨';
    $('#save-state').classList.remove('saving');
  }).catch(() => {
    $('#save-state').textContent = '저장 공간 부족';
    $('#save-state').classList.remove('saving');
    if (!quiet) toast('기기에 저장하지 못했어. 사진 용량을 줄여 다시 해봐.');
  });
  $('#save-state').textContent = '저장 중';
  $('#save-state').classList.add('saving');
}

async function restore() {
  try {
    const saved = await toyStore.all();
    for (const record of saved) {
      records.set(record.id, record);
      await appScene.add(record);
    }
    setCount();
  } catch (error) {
    console.warn('Could not restore local toys', error);
    toast('저장된 말랑이를 불러오지 못했어.');
  }
}

function makeCandidateRow(candidate, index) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'candidate-row';
  row.setAttribute('aria-pressed', selectedCandidates.has(index) ? 'true' : 'false');
  const image = document.createElement('img');
  image.src = URL.createObjectURL(candidate.blob);
  image.alt = '';
  candidate.previewUrl = image.src;
  const label = document.createElement('span');
  label.className = 'candidate-name';
  label.textContent = candidate.label;
  const check = document.createElement('span');
  check.className = 'candidate-check';
  check.textContent = selectedCandidates.has(index) ? '✓' : '';
  row.append(image, label, check);
  row.addEventListener('click', () => {
    if (selectedCandidates.has(index)) selectedCandidates.delete(index);
    else selectedCandidates.add(index);
    row.setAttribute('aria-pressed', selectedCandidates.has(index) ? 'true' : 'false');
    check.textContent = selectedCandidates.has(index) ? '✓' : '';
    updateSheetAction();
  });
  return row;
}

function updateSheetAction() {
  const action = $('#add-selected');
  if (action) action.textContent = selectedCandidates.size ? `${selectedCandidates.size}개 말랑하게 만들기` : '대상을 골라줘';
  if (action) action.disabled = selectedCandidates.size === 0;
}

function openCandidates(candidates, filename) {
  activeCandidates.forEach((candidate) => candidate.previewUrl && URL.revokeObjectURL(candidate.previewUrl));
  activeCandidates = candidates;
  selectedCandidates = new Set(candidates.length ? [0] : []);
  currentFileName = filename;
  $('#sheet-title').textContent = candidates.length > 1 ? '어떤 걸 말랑하게 할까?' : '이거 말랑하게 할까?';
  $('#sheet-description').textContent = candidates[0]?.fallback
    ? '자동 분리에 실패했어. 원본 사진을 말랑이로 추가할 수 있어.'
    : '분리한 대상만 골라서 놀이터에 둘 수 있어.';
  list.replaceChildren();
  candidates.forEach((candidate, index) => list.append(makeCandidateRow(candidate, index)));
  const footer = document.createElement('div');
  footer.className = 'sheet-footer';
  const action = document.createElement('button');
  action.type = 'button';
  action.id = 'add-selected';
  action.className = 'primary-button sheet-action';
  action.addEventListener('click', addSelectedCandidates);
  footer.append(action);
  list.append(footer);
  updateSheetAction();
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
}

function closeSheet() {
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 220);
  activeCandidates.forEach((candidate) => candidate.previewUrl && URL.revokeObjectURL(candidate.previewUrl));
  activeCandidates = [];
  selectedCandidates.clear();
}

async function addSelectedCandidates() {
  const selected = [...selectedCandidates].map((index) => activeCandidates[index]).filter(Boolean);
  const filename = currentFileName.replace(/\.[^.]+$/, '').slice(0, 32) || '내 말랑이';
  closeSheet();
  for (let index = 0; index < selected.length; index++) {
    const candidate = selected[index];
    const id = crypto.randomUUID();
    const x = (Math.random() - 0.5) * Math.min(5.2, appScene.camera.right * 1.05);
    const y = (Math.random() - 0.48) * 2.7;
    const record = { id, name: selected.length > 1 ? `${candidate.label} ${index + 1}` : filename, blob: candidate.blob, x, y, preset: 'soft' };
    const item = await appScene.add(record);
    records.set(id, record);
    persistItem(item);
    appScene.select(item);
  }
  setCount();
  setStatus('툭. 말랑이 추가됨');
  toast('눌러봐. 늘려봐.');
  if (pendingFiles.length) processNextFile();
}

async function processNextFile() {
  const file = pendingFiles.shift();
  if (!file) {
    input.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    toast('사진 파일만 넣을 수 있어.');
    processNextFile();
    return;
  }
  setStatus('사진을 보고 있어…', true);
  try {
    const candidates = await findCutouts(file, (progress) => {
      if (progress?.status === 'progress') setStatus('처음이면 AI를 준비하는 중…', true);
    });
    if (!candidates.length) throw new Error('No foreground objects found');
    setStatus('대상 분리 완료');
    openCandidates(candidates, file.name);
  } catch (error) {
    console.error('Foreground extraction failed', error);
    setStatus('자동 누끼를 못 땄어');
    openCandidates([{ label: '원본 사진', blob: file, fallback: true }], file.name);
  }
}

function openPicker(capture = false) {
  if (capture) input.setAttribute('capture', 'environment');
  else input.removeAttribute('capture');
  input.click();
}

function nextPreset() {
  const item = appScene.selected;
  if (!item) return;
  const index = presets.findIndex((preset) => preset.id === item.preset);
  const next = presets[(index + 1) % presets.length];
  appScene.setPreset(item, next.id);
  $('#material-label').textContent = next.label;
}

function deleteSelected() {
  const item = appScene.selected;
  if (!item) return;
  appScene.remove(item);
  records.delete(item.id);
  saving = saving.then(() => toyStore.delete(item.id)).catch((error) => console.warn('Could not delete toy', error));
  setCount();
  toast('말랑이를 지웠어.');
}

async function sharePlayground() {
  if (!records.size) return toast('먼저 말랑이를 만들어봐.');
  canvas.toBlob(async (blob) => {
    if (!blob) return toast('이미지를 만들지 못했어.');
    const file = new File([blob], 'malangee-buja.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ title: '내 말랑이 놀이터', files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'malangee-buja.png';
        link.click();
        URL.revokeObjectURL(url);
        toast('놀이터 이미지를 저장했어.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') toast('공유를 열지 못했어.');
    }
  }, 'image/png');
}

$('#add-button').addEventListener('click', () => openPicker());
$('#empty-add').addEventListener('click', () => openPicker());
input.addEventListener('change', () => {
  pendingFiles = [...input.files];
  input.removeAttribute('capture');
  if (pendingFiles.length) processNextFile();
});
$('#stretch-button').addEventListener('click', () => appScene.stretch());
$('#bounce-button').addEventListener('click', () => appScene.bounce());
$('#material-button').addEventListener('click', nextPreset);
$('#sound-button').addEventListener('click', () => {
  const enabled = toggleSound();
  $('#sound-label').textContent = enabled ? '소리 켬' : '소리 끔';
  $('#sound-button').classList.toggle('muted', !enabled);
  toast(enabled ? '소리 켰어.' : '소리 껐어.');
});
$('#delete-button').addEventListener('click', deleteSelected);
$('#share-button').addEventListener('click', sharePlayground);
$('#menu-button').addEventListener('click', () => toast('말랑이를 누르고, 잡아당기고, 두 손가락으로 늘려봐.', 3200));
sheet.addEventListener('click', (event) => { if (event.target.closest('[data-close-sheet]')) closeSheet(); });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !sheet.hidden) closeSheet(); });
window.addEventListener('beforeunload', () => { saving.catch(() => {}); });

restore();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
