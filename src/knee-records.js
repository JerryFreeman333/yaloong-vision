import {restoreAttempt} from './knee-rules.js';

const draftKey = 'bpx.knee.draft.v1';
const reportPrefix = 'bpx.knee.report.v1.';
const bundleFormat = 'bpx-knee-reports';
let fallbackDraft;

function read(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveDraft(attempt) {
  if (attempt?.mode === 'demo') return true;
  const data = attempt == null ? null : JSON.stringify(attempt);
  const saved = write(draftKey, data);
  fallbackDraft = saved ? undefined : data;
  return saved;
}
export function loadDraft() {
  const data = fallbackDraft === undefined ? read(draftKey) : fallbackDraft;
  return data ? restoreAttempt(data) : null;
}

function isReport(attempt) {
  return Boolean(attempt?.submittedAt && attempt.stage === 'done' && attempt.mode !== 'demo');
}
export function archiveAttempt(attempt) {
  if (!isReport(attempt)) return false;
  const key = reportPrefix + attempt.id;
  if (isReport(restoreAttempt(read(key)))) return true;
  return write(key, JSON.stringify(attempt));
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportAttempt(attempt) {
  const safeId = String(attempt.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const data = JSON.stringify({format:bundleFormat, fileVersion:1, attempts:[attempt]});
  download('BPX-装配工单-' + safeId + '.json', data, 'application/json;charset=utf-8');
}
