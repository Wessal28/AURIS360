// Receives browser CSP violation reports without storing sensitive request data.
// Reports are deliberately reduced to a small allowlist before reaching Vercel logs.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_REPORTS = 20;

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const body = parseBody(req.body);
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Report too large' });
    }
    const reports = normalizeReports(body);
    if (reports.length) console.warn('AURIS360_CSP_REPORT', JSON.stringify(reports));
    return res.status(204).end();
  } catch (_) {
    return res.status(400).json({ error: 'Invalid CSP report' });
  }
};

function parseBody(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') return JSON.parse(value || '{}');
  if (value && typeof value === 'object') return value;
  return {};
}

function normalizeReports(body) {
  const source = Array.isArray(body) ? body : [body];
  return source.slice(0, MAX_REPORTS).map((entry) => {
    const report = entry && (entry['csp-report'] || entry.body || entry);
    if (!report || typeof report !== 'object') return null;
    return {
      directive: text(report['effective-directive'] || report.effectiveDirective || report['violated-directive'], 100),
      disposition: text(report.disposition, 20),
      blocked: safeUrl(report['blocked-uri'] || report.blockedURL),
      document: safeUrl(report['document-uri'] || report.documentURL),
      source: safeUrl(report['source-file'] || report.sourceFile),
      status: boundedNumber(report['status-code'] || report.statusCode, 0, 599),
      line: boundedNumber(report['line-number'] || report.lineNumber, 0, 10000000),
      column: boundedNumber(report['column-number'] || report.columnNumber, 0, 10000000)
    };
  }).filter((report) => report && report.directive);
}

function safeUrl(value) {
  const input = text(value, 2048);
  if (!input) return '';
  if (/^(inline|eval|self|data|blob)$/i.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input);
    return text(url.origin + url.pathname, 500);
  } catch (_) {
    return text(input.replace(/[?#].*$/, ''), 500);
  }
}

function text(value, limit) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit);
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : 0;
}

module.exports._test = { parseBody, normalizeReports, safeUrl, boundedNumber, MAX_BODY_BYTES, MAX_REPORTS };
