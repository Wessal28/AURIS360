const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const endpoint = require(path.join(root, 'api', 'csp-report.js'));

test('report-only CSP sends violations to the bounded same-origin endpoint', () => {
  const rule = config.headers.find((item) => item.source === '/(.*)');
  const headers = Object.fromEntries(rule.headers.map((item) => [item.key, item.value]));
  assert.match(headers['Content-Security-Policy-Report-Only'], /report-uri \/api\/csp-report/);
  assert.match(headers['Content-Security-Policy-Report-Only'], /report-to csp-endpoint/);
  assert.equal(headers['Reporting-Endpoints'], 'csp-endpoint="/api/csp-report"');
  assert.equal(config.functions['api/csp-report.js'].maxDuration, 10);
});

test('CSP reports are allowlisted, bounded and stripped of URL secrets', () => {
  const reports = endpoint._test.normalizeReports({
    'csp-report': {
      'effective-directive': 'style-src-attr',
      'blocked-uri': 'https://auris360.app/module?token=secret#record',
      'document-uri': 'https://auris360.app/?session=secret',
      'source-file': 'https://auris360.app/app.js?build=private',
      'line-number': 42,
      sample: 'must never be logged'
    }
  });
  assert.deepEqual(reports, [{
    directive: 'style-src-attr', disposition: '',
    blocked: 'https://auris360.app/module', document: 'https://auris360.app/',
    source: 'https://auris360.app/app.js', status: 0, line: 42, column: 0
  }]);
  assert.equal(JSON.stringify(reports).includes('secret'), false);
  assert.equal(JSON.stringify(reports).includes('must never be logged'), false);
  assert.equal(endpoint._test.normalizeReports(Array(30).fill({ body: { effectiveDirective: 'style-src-attr' } })).length, 20);
});

test('collector rejects non-POST requests and oversized bodies', async () => {
  const response = () => ({
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  });
  const getRes = response();
  await endpoint({ method: 'GET' }, getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(getRes.headers.Allow, 'POST');
  const largeRes = response();
  await endpoint({ method: 'POST', body: { value: 'x'.repeat(endpoint._test.MAX_BODY_BYTES + 1) } }, largeRes);
  assert.equal(largeRes.statusCode, 413);
});
