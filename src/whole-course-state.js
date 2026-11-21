import {WHOLE_CHAPTERS} from './whole-course-content.js';

const VERSION = 'BPX-WHOLE.2';
const STORAGE_KEY = 'bpx.whole-course.v1';
const ids = WHOLE_CHAPTERS.map(chapter => chapter.id);
const maxBytes = 300_000;
let unsaved;

const validDate = value => typeof value === 'string' && value.length === 24 &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const emptyChapter = () => ({history:[], complete:false});

export function newCourse(student = '') {
  const now = new Date().toISOString();
  return {
    id:crypto.randomUUID(), version:VERSION, student:String(student).trim().slice(0,80),
    revision:0, createdAt:now, updatedAt:now,
    chapters:Object.fromEntries(ids.map(id => [id, emptyChapter()])), signedAt:null,
  };
}

export const canFinish = course => ids.every(id => course.chapters[id].complete);
export const isFinished = course => canFinish(course) && validDate(course.signedAt);
export const nextChapter = course => ids.find(id => !course.chapters[id].complete) ?? null;
export function canOpenChapter(course, id) {
  const index = ids.indexOf(id);
  return index !== -1 && ids.slice(0,index).every(key => course.chapters[key].complete);
}

function validProgress(id, history, complete) {
  const chapter = WHOLE_CHAPTERS.find(c => c.id === id);
  return chapter && Array.isArray(history) && history.length <= chapter.actions &&
    complete === (history.length === chapter.actions) &&
    history.every(part => part === null || (typeof part === 'string' && part.length > 0 && part.length <= 128));
}
function validCourse(course) {
  return course?.version === VERSION && typeof course.id === 'string' && course.id.length > 0 && course.id.length <= 100 &&
    typeof course.student === 'string' && course.student.length <= 80 &&
    validDate(course.createdAt) && validDate(course.updatedAt) && Number.isSafeInteger(course.revision) && course.revision >= 0 &&
    ids.every(id => validProgress(id,course.chapters?.[id]?.history,course.chapters?.[id]?.complete)) &&
    (course.signedAt === null || isFinished(course));
}
function parseCourse(raw) {
  if (typeof raw !== 'string' || raw.length > maxBytes) return null;
  try {
    let course = JSON.parse(raw);
    if (course?.version === 'BPX-WHOLE.1') {
      // Earlier courses allowed independent chapters. Keep their real CAD commits;
      // an out-of-order chapter becomes available once its prerequisites are built.
      const chapters = Object.fromEntries(ids.map(id => {
        const {history,complete} = course.chapters[id];
        return [id,{history,complete}];
      }));
      const {id,student,revision,createdAt,updatedAt} = course;
      course = {version:VERSION,id,student,revision,createdAt,updatedAt,chapters,signedAt:course.final?.passedAt ?? null};
    }
    return validCourse(course) ? course : null;
  } catch { return null; }
}

export function readCourse() {
  if (unsaved) return parseCourse(unsaved.raw);
  try { return parseCourse(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}

const identity = course => course ? course.id + '/' + course.revision : null;
export function saveCourse(course, replacing = null) {
  if (!validCourse(course)) return false;
  const revision = course.revision + 1;
  const updatedAt = new Date().toISOString();
  const raw = JSON.stringify({...course, revision, updatedAt});
  let base;
  try {
    base = identity(parseCourse(localStorage.getItem(STORAGE_KEY)));
    const retry = unsaved?.id === course.id && (unsaved.base === base || (unsaved.base === undefined && base === null));
    if (base && base !== identity(course) && base !== identity(replacing) && !retry) return false;
    localStorage.setItem(STORAGE_KEY,raw);
    unsaved = undefined;
  } catch {
    unsaved = {id:course.id, raw, base};
    course.revision = revision;
    course.updatedAt = updatedAt;
    return false;
  }
  course.revision = revision;
  course.updatedAt = updatedAt;
  return true;
}

export function applyProgress(course, id, history, complete = false) {
  if (!canOpenChapter(course,id) || !validProgress(id,history,complete)) return false;
  const chapter = course.chapters[id];
  const extendsPrevious = chapter.history.every((part,i) => history[i] === part);
  if (extendsPrevious && chapter.history.length === history.length && chapter.complete === complete) return false;
  // Detaching an earlier part invalidates the later assemblies attached to it.
  if (!extendsPrevious) {
    for (const later of ids.slice(ids.indexOf(id)+1)) course.chapters[later] = emptyChapter();
  }
  course.chapters[id] = {history:history.slice(),complete};
  course.signedAt = null;
  return true;
}
export function signCourse(course, student) {
  if (!canFinish(course) || isFinished(course)) return false;
  course.student = String(student ?? '').trim().slice(0,80);
  course.signedAt = new Date().toISOString();
  return true;
}
export function courseReportText(course) {
  if (!validCourse(course) || !isFinished(course)) return null;
  const lines = ['BLACK PANTHER X 整机装配记录', '工单号　' + course.id,
    '装配人　' + (course.student || '本机学员'),
    '完成时间　' + new Date(course.signedAt).toLocaleString('zh-CN'),
    '工艺依据　C2P20724 改1', ''];
  for (const chapter of WHOLE_CHAPTERS) {
    const count = course.chapters[chapter.id].history.length;
    lines.push(chapter.title + '　' + chapter.steps + ' 道工序，已提交操作 ' + count + ' 次');
  }
  lines.push('', '装配结果　四腿及提手已上机，电池已沿槽入座并锁合。');
  return lines.join('\n');
}
export function downloadCourseReport(course) {
  const text = courseReportText(course);
  if (!text) return false;
  const url = URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'BPX-整机装配记录-' + course.id + '.txt';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return true;
}
