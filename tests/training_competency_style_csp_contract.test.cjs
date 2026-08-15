const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-training-competency-static.css'), 'utf8');
const coursePathJs = fs.readFileSync(path.join(root, 'elearning-course-path.js'), 'utf8');
const coursePathCss = fs.readFileSync(path.join(root, 'elearning-course-path.css'), 'utf8');
const start = index.indexOf('<div id="page-training"');
const end = index.indexOf('<div id="page-moc"', start);
const section = index.slice(start, end);

test('Training & Competency has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-training-competency-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-training-s-[a-f0-9]{10}/g) || []).length >= 272);
  assert.ok((css.match(/^\.auris-training-s-[a-f0-9]{10}\{/gm) || []).length >= 98);
});

test('Planning, learning, assessment, competency and authorisation states remain runtime-controlled', () => {
  for (const id of ['train-view-plan', 'train-view-tna', 'train-view-induction', 'train-view-elearning', 'train-view-followup', 'train-view-competency', 'train-view-auth', 'tp-form', 'tna-add-btn', 'ind-form', 'elc-form', 'ele-form', 'tf-form', 'comp-form', 'auth-form']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-training-s-|<[^>]*class="[^"]*auris-training-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-training-s-[a-f0-9]{10}\\{`));
  }
  assert.match(css, /grid-template-columns:repeat\(6,1fr\)/);
  assert.match(css, /accent-color:var\(--green\)/);
  assert.doesNotMatch(css, /!important/i);
  assert.doesNotMatch(coursePathJs, /\sstyle=/i);
  for (const className of ['elc-legacy-video-note', 'elc-quiz-head', 'elc-quiz-toggle']) {
    assert.match(coursePathCss, new RegExp(`\\.${className}\\{`));
    assert.match(coursePathJs, new RegExp(className));
  }
});
