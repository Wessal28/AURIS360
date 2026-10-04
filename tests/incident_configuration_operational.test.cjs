const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'incident-management-upgrade.js'), 'utf8');
const helpers = source.slice(source.indexOf('function activeConfig('), source.indexOf('function notify('));
const types = source.match(/var INCIDENT_TYPES=([^;]+);/)[1];
function rules(records, company = 'company-a') {
  const context = {X:{data:{config:records}}, companyId:()=>company, Date};
  vm.runInNewContext(`var INCIDENT_TYPES=${types};${helpers}`, context);
  return context;
}

test('incident configuration exposes only controls connected to operational workflows', () => {
  assert.match(source, /var CONFIG_GROUPS=\['Incident Types','Triage Rules'\]/);
  assert.doesNotMatch(source, /window\.imv2TestConfig|window\.imv2ImpactConfig|config:\{title:/);
  assert.match(source, /due\.setDate\(due\.getDate\(\)\+triageDueDays\(\)\)/);
  assert.match(source, /window\.imv2IncidentTypeAllowed/);
});

test('only current published rules from the selected company take effect', () => {
  const records = [
    {company_id:'company-a',workspace:'Triage Rules',code:'triage_due_days',status:'draft',version_no:3,payload:{triage_due_days:30}},
    {company_id:'company-a',workspace:'Triage Rules',code:'triage_due_days',status:'published',version_no:2,effective_from:'2999-01-01',payload:{triage_due_days:20}},
    {company_id:'company-b',workspace:'Triage Rules',code:'triage_due_days',status:'published',version_no:4,payload:{triage_due_days:25}},
    {company_id:'company-a',workspace:'Triage Rules',code:'triage_due_days',status:'published',version_no:1,payload:{triage_due_days:5}}
  ];
  const context = rules(records);
  assert.equal(context.triageDueDays(), 5);
  assert.equal(rules(records,'company-b').triageDueDays(),25);
  assert.equal(rules([]).triageDueDays(),1);
});

test('disabled incident types disappear from new reports without deleting the default catalogue', () => {
  const context=rules([{company_id:'company-a',workspace:'Incident Types',code:'enabled_types',status:'published',version_no:1,payload:{enabled_types:['injury','fire','unknown']}}]);
  assert.deepEqual(Array.from(context.enabledIncidentTypes()),['injury','fire']);
  assert.equal(rules([]).enabledIncidentTypes().length,11);
});
