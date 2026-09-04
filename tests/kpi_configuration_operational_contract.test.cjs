const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'kpi-configuration.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'kpi-module-upgrade.css'), 'utf8');

test('KPI configuration exposes only operational sections', () => {
  const nav = source.match(/var NAV=\[(.*?)\];/s);
  assert.ok(nav, 'configuration navigation must be declared');
  for (const label of ['Status & Periods', 'Calculations', 'Data Sources', 'Approvals', 'Objectives Register', 'Audit History']) {
    assert.match(nav[1], new RegExp(label.replace('&', '\\&')));
  }
  for (const label of ['General Settings', 'KPI Templates', 'Notifications', 'Permissions', 'Reports & Display']) {
    assert.doesNotMatch(nav[1], new RegExp(label.replace('&', '\\&')));
  }
  assert.equal((nav[1].match(/\['/g) || []).length, 6);
});

test('visible editable controls are connected to current KPI runtime consumers', () => {
  for (const setting of [
    'targets.on_track_percent',
    'targets.at_risk_percent',
    'targets.zero_tolerance_override',
    'targets.critical_override',
    'cycles.current_period_excluded',
    'calculations.aggregation',
    'sources.default_source',
    'sources.refresh_frequency',
    'sources.allow_manual_override',
    'workflow.stage1',
    'workflow.stage2',
    'workflow.stage3',
    'workflow.self_approval',
    'audit.reason_required'
  ]) assert.match(source, new RegExp(`input\\('${setting.replace('.', '\\.')}','`));

  for (const inactiveLabel of [
    'Entry deadline (working day)',
    'Conflict resolution',
    'Escalate after (days)',
    'Configuration editors',
    'Default scorecard columns',
    'Retention (years)'
  ]) assert.doesNotMatch(source, new RegExp(`input\\([^\\n]+${inactiveLabel.replace(/[()]/g, '\\$&')}`));
});

test('configuration explains operational scope and preserves responsive styling', () => {
  assert.match(source, /Operational settings only/);
  assert.match(source, /Access roles and notification delivery are managed in their dedicated administration areas/);
  assert.match(source, /function normaliseOperationalConfig/);
  assert.match(source, /aggregation='average'/);
  assert.match(styles, /\.kpi-cfg-operational/);
});
