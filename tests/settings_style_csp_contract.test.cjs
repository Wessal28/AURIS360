const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-settings-static.css'), 'utf8');
const start = index.indexOf('<div id="page-settings"');
const end = index.indexOf('<div id="page-sitemap"', start);
const section = index.slice(start, end);

test('Settings has no inline style attributes', () => {
  assert.match(index, /<link rel="stylesheet" href="auris-settings-static\.css\?v=\d+-\d+">/);
  assert.equal((section.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length, 0);
  assert.ok((section.match(/auris-settings-s-[a-f0-9]{10}/g) || []).length >= 204);
  assert.ok((css.match(/^\.auris-settings-s-[a-f0-9]{10}\{/gm) || []).length >= 114);
});

test('Branding, security, diagnostics, notifications and onboarding remain runtime-controlled', () => {
  for (const id of ['settings-resilience-simulation-card', 'branding-studio', 'brand-presets', 'br-logo-preview', 'br-logo-placeholder', 'br-logo-dark-preview', 'prev-sidebar', 'prev-email-header', 'prev-login-logo', 'settings-rollout-control-card', 'settings-rollback-rehearsal-card', 'settings-system3health-card', 'settings-relationship-repair-card', 'settings-person-identity-card', 'settings-client-demo-card', 'settings-ptw-approver-card', 'settings-workflow-card', 'settings-custom3fields-card', 'settings-offline-sync-diagnostic-card', 'settings-notif-card', 'logo-settings', 'ai-panel', 'integ-notif-panel', 'app-confirm3modal', 'onboard-modal', 'ob-step-2', 'ob-step-3', 'ob-step-4', 'ob-summary']) {
    assert.match(section, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*auris-settings-s-|<[^>]*class="[^"]*auris-settings-s-[^"]*"[^>]*id="${id}"`));
    assert.match(css, new RegExp(`#${id}\\.auris-settings-s-[a-f0-9]{10}\\{`));
  }
  for (const id of ['my-profile-info', 'security-readiness-body', 'offline-drafts-body', 'notif-settings-body', 'ai-messages', 'ob-co-name', 'ob-admin-email', 'ob-next-btn']) {
    assert.match(section, new RegExp(`id="${id}"`));
  }
  assert.match(css, /display:none/);
  assert.match(css, /grid-template-columns:/);
  assert.doesNotMatch(css, /!important/i);
});
