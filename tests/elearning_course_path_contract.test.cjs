const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'elearning-course-path.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'elearning_course_path_upgrade.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('course paths support ordered videos with a legacy single-video fallback', () => {
  assert.match(js, /learning_path/);
  assert.match(js, /legacy-video/);
  assert.match(js, /sequence:i\+1/);
  assert.match(js, /Course videos and final quiz/);
});

test('videos open in the protected in-app player and not as direct downloads', () => {
  assert.match(js, /controlsList=\"nodownload noplaybackrate noremoteplayback\"/);
  assert.match(js, /oncontextmenu=\"return false\"/);
  assert.doesNotMatch(js, /window\.open\(course\.course_url/);
  assert.match(js, /eleOpenVideoPlayer\(\{course:c,preview:true\}\)/);
});

test('the final quiz remains locked until all videos are completed', () => {
  assert.match(js, /function allVideosDone/);
  assert.match(js, /!allVideosDone\(\)\?'locked'/);
  assert.match(js, /Complete the previous video first/);
  assert.match(js, /score>=quiz\.passing_score/);
});

test('quiz attempts and lesson progress are tenant-controlled and auditable', () => {
  assert.match(sql, /create table if not exists public\.elearning_quiz_attempts/i);
  assert.match(sql, /add column if not exists learning_progress jsonb/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /elearning_quiz_attempts_tenant_read/i);
  assert.match(js, /\/elearning_quiz_attempts/);
});

test('course path assets are loaded by the application', () => {
  assert.match(html, /elearning-course-path\.css/);
  assert.match(html, /elearning-course-path\.js/);
});

