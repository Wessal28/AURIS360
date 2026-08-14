const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=require('./application_source.cjs')();

function extract(name,next){
  const start=html.indexOf(`function ${name}`),end=html.indexOf(`function ${next}`,start);
  assert.ok(start>=0&&end>start,`${name} helper not found`);
  return html.slice(start,end);
}

test('shared URL validator blocks executable and insecure external protocols',()=>{
  const context={URL,window:{location:{origin:'https://auris360.app'}}};
  vm.runInNewContext(extract('aurisSafeUrl','aurisSafeMediaUrl')+';this.safe=aurisSafeUrl;',context);
  assert.equal(context.safe('javascript:alert(1)'),'');
  assert.equal(context.safe('data:text/html,<script>alert(1)</script>'),'');
  assert.equal(context.safe('vbscript:msgbox(1)'),'');
  assert.equal(context.safe('http://insecure.example/file.pdf'),'');
  assert.equal(context.safe('https://files.example/report.pdf'),'https://files.example/report.pdf');
  assert.equal(context.safe('/documents/123'),'/documents/123');
  assert.equal(context.safe('http://localhost:3000/file.pdf'),'http://localhost:3000/file.pdf');
});

test('stored SOP HTML and database media URLs use the hardening boundary',()=>{
  assert.match(html,/function aurisSanitizeStoredHtml[\s\S]*querySelectorAll\('script,iframe,object,embed/);
  assert.match(html,/name\.indexOf\('on'\)===0/);
  assert.match(html,/aurisSanitizeStoredHtml\(sop\.html_content\)/);
  assert.doesNotMatch(html,/<body>'\+sop\.html_content/);
  assert.match(html,/var url\s*=\s*aurisSafeMediaUrl\(doc\.file_url,'document'\)/);
  assert.match(html,/var videoUrl=aurisSafeMediaUrl\(course\.course_url,'video'\)/);
  assert.match(html,/var companyLogo = aurisSafeMediaUrl/);
});

test('new-window database links are isolated from the opener',()=>{
  assert.match(html,/certUrl[^\n]*rel="noopener noreferrer"/);
  assert.match(html,/safeDocumentUrl[\s\S]{0,180}rel="noopener noreferrer"/);
  assert.match(html,/id="dc-viewer-open"[^>]*rel="noopener noreferrer"/);
});
