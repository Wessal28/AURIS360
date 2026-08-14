(function () {
  'use strict';
  var handlers = {
    "h0001": function (event) {
if(event.key==='Enter')document.getElementById('login-pw').focus()
    },
    "h0002": function (event) {
authShowPanel('forgot');return false
    },
    "h0003": function (event) {
if(event.key==='Enter')doLogin()
    },
    "h0004": function (event) {
authTogglePw('login-pw',this)
    },
    "h0005": function (event) {
doLogin()
    },
    "h0006": function (event) {
authTogglePw('reg-pw',this)
    },
    "h0007": function (event) {
doRegister()
    },
    "h0008": function (event) {
authShowPanel('signin');return false
    },
    "h0009": function (event) {
if(event.key==='Enter')doPasswordReset()
    },
    "h0010": function (event) {
doPasswordReset()
    },
    "h0011": function (event) {
doUpdatePassword()
    },
    "h0012": function (event) {
mobileToggleSidebar()
    },
    "h0013": function (event) {
mobileGoBack()
    },
    "h0014": function (event) {
notificationCentreToggle(event)
    },
    "h0015": function (event) {
mobileToggleSearch()
    },
    "h0016": function (event) {
mobileCloseSidebar()
    },
    "h0017": function (event) {
mobileCloseModules()
    },
    "h0018": function (event) {
event.stopPropagation()
    },
    "h0019": function (event) {
mobileSearchModules(this.value)
    },
    "h0020": function (event) {
mobileNavTo('dashboard','Dashboard',this)
    },
    "h0021": function (event) {
mobileNavTo('events','Incidents',this)
    },
    "h0022": function (event) {
mobileNavTo('observation','Observations',this)
    },
    "h0023": function (event) {
mobileNavTo('kpi','KPIs',this)
    },
    "h0024": function (event) {
mobileToggleModules()
    },
    "h0025": function (event) {

    },
    "h0026": function (event) {
sbChangeRole()
    },
    "h0027": function (event) {
showPage('dashboard',this)
    },
    "h0028": function (event) {
showPage('executive',this)
    },
    "h0029": function (event) {
showPage('ai-insights',this)
    },
    "h0030": function (event) {
showPage('kpi',this)
    },
    "h0031": function (event) {
showPage('workschedule',this)
    },
    "h0032": function (event) {
showPage('events',this)
    },
    "h0033": function (event) {
showPage('observation',this)
    },
    "h0034": function (event) {
showPage('inspection',this)
    },
    "h0035": function (event) {
showPage('risk',this)
    },
    "h0036": function (event) {
showPage('tools',this)
    },
    "h0037": function (event) {
showPage('fleet',this)
    },
    "h0038": function (event) {
showPage('atex',this)
    },
    "h0039": function (event) {
showPage('sitemap',this)
    },
    "h0040": function (event) {
showPage('permit',this)
    },
    "h0041": function (event) {
showPage('contractor',this)
    },
    "h0042": function (event) {
showPage('emergency',this)
    },
    "h0043": function (event) {
showPage('ohealth',this)
    },
    "h0044": function (event) {
showPage('ppe',this)
    },
    "h0045": function (event) {
showPage('fire',this)
    },
    "h0046": function (event) {
showPage('chemical',this)
    },
    "h0047": function (event) {
showPage('esg',this)
    },
    "h0048": function (event) {
showPage('noise',this)
    },
    "h0049": function (event) {
showPage('meetings',this)
    },
    "h0050": function (event) {
showPage('training',this)
    },
    "h0051": function (event) {
showPage('actions',this)
    },
    "h0052": function (event) {
showPage('legal',this)
    },
    "h0053": function (event) {
showPage('sop',this)
    },
    "h0054": function (event) {
showPage('swms',this)
    },
    "h0055": function (event) {
showPage('documents',this)
    },
    "h0056": function (event) {
showPage('people',this)
    },
    "h0057": function (event) {
showPage('users',this)
    },
    "h0058": function (event) {
showPage('admin',this)
    },
    "h0059": function (event) {
showPage('integrations',this)
    },
    "h0060": function (event) {
showPage('approvals',this)
    },
    "h0061": function (event) {
showPage('audit',this)
    },
    "h0062": function (event) {
showPage('settings',this)
    },
    "h0063": function (event) {
doLogout()
    },
    "h0064": function (event) {
pwaInstall()
    },
    "h0065": function (event) {
sidebarCycle()
    },
    "h0066": function (event) {
modulesMenuToggle(event)
    },
    "h0067": function (event) {
saCompanyMenuToggle(event)
    },
    "h0068": function (event) {
devModeToggle()
    },
    "h0069": function (event) {
dashOpenIncidentForm()
    },
    "h0070": function (event) {
dashOpenObservationForm()
    },
    "h0071": function (event) {
mobileNavTo('kpi','KPIs',document.getElementById('mob-btn-kpi'))
    },
    "h0072": function (event) {
loadDash()
    },
    "h0073": function (event) {
showPage('executive',document.getElementById('nav-executive'))
    },
    "h0074": function (event) {
printMonthlySummary()
    },
    "h0075": function (event) {
loadDash()
    },
    "h0076": function (event) {
showPage('events',document.querySelector('.nav-item'))
    },
    "h0077": function (event) {
showPage('training',null)
    },
    "h0078": function (event) {
showPage('permit',null)
    },
    "h0079": function (event) {
showPage('events',null)
    },
    "h0080": function (event) {
showPage('observation',null)
    },
    "h0081": function (event) {
dashOpenMyActions()
    },
    "h0082": function (event) {
dashOpenElearning()
    },
    "h0083": function (event) {
showPage('emergency',null)
    },
    "h0084": function (event) {
showPage('actions',null)
    },
    "h0085": function (event) {
showPage('people',null)
    },
    "h0086": function (event) {
showPage('legal',null)
    },
    "h0087": function (event) {
showPage('esg',null)
    },
    "h0088": function (event) {
showPage('inspection',null)
    },
    "h0089": function (event) {
showPage('kpi',null)
    },
    "h0090": function (event) {
genDashAI()
    },
    "h0091": function (event) {
loadExecutive()
    },
    "h0092": function (event) {
execExportReport()
    },
    "h0093": function (event) {
showPage('dashboard',document.getElementById('nav-dashboard'))
    },
    "h0094": function (event) {
execTab('overview',this)
    },
    "h0095": function (event) {
execTab('safety',this)
    },
    "h0096": function (event) {
execTab('compliance',this)
    },
    "h0097": function (event) {
execTab('esg',this)
    },
    "h0098": function (event) {
execTab('reports',this)
    },
    "h0099": function (event) {
execAIReport('weekly_summary')
    },
    "h0100": function (event) {
execAIReport('executive_summary')
    },
    "h0101": function (event) {
execAIReport('monthly_report')
    },
    "h0102": function (event) {
execAIReport('annual_stats')
    },
    "h0103": function (event) {
this.style.borderColor='#185FA5';this.style.boxShadow='0 4px 16px rgba(24,95,165,.2)'
    },
    "h0104": function (event) {
this.style.borderColor='transparent';this.style.boxShadow=''
    },
    "h0105": function (event) {
execGenerateReport('monthly')
    },
    "h0106": function (event) {
event.stopPropagation();execGenerateReport('monthly')
    },
    "h0107": function (event) {
this.style.borderColor='#5B21B6';this.style.boxShadow='0 4px 16px rgba(91,33,182,.2)'
    },
    "h0108": function (event) {
execGenerateReport('board')
    },
    "h0109": function (event) {
event.stopPropagation();execGenerateReport('board')
    },
    "h0110": function (event) {
this.style.borderColor='#065F46';this.style.boxShadow='0 4px 16px rgba(6,95,70,.2)'
    },
    "h0111": function (event) {
execGenerateReport('annual')
    },
    "h0112": function (event) {
event.stopPropagation();execGenerateReport('annual')
    },
    "h0113": function (event) {
this.style.borderColor='#1D9E75';this.style.boxShadow='0 4px 16px rgba(29,158,117,.2)'
    },
    "h0114": function (event) {
execGenerateReport('esg')
    },
    "h0115": function (event) {
event.stopPropagation();execGenerateReport('esg')
    },
    "h0116": function (event) {
this.style.borderColor='#0891B2';this.style.boxShadow='0 4px 16px rgba(8,145,178,.2)'
    },
    "h0117": function (event) {
execGenerateReport('sustainability')
    },
    "h0118": function (event) {
event.stopPropagation();execGenerateReport('sustainability')
    },
    "h0119": function (event) {
this.style.borderColor='#EF9F27';this.style.boxShadow='0 4px 16px rgba(239,159,39,.2)'
    },
    "h0120": function (event) {
execGenerateReport('compliance')
    },
    "h0121": function (event) {
event.stopPropagation();execGenerateReport('compliance')
    },
    "h0122": function (event) {
navigator.clipboard.writeText(document.getElementById('exec-report-text').textContent).then(()=>toast('Copied!'))
    },
    "h0123": function (event) {
document.getElementById('exec-report-output').style.display='none'
    },
    "h0124": function (event) {
kpiLoadAll()
    },
    "h0125": function (event) {
openObjModal()
    },
    "h0126": function (event) {
kpiPrint()
    },
    "h0127": function (event) {
kpiSwitchTab('overview',this)
    },
    "h0128": function (event) {
kpiSwitchTab('monthly',this)
    },
    "h0129": function (event) {
closeKpiModal('obj-modal')
    },
    "h0130": function (event) {
kpiSelectColor('#1D9E75',this)
    },
    "h0131": function (event) {
kpiSelectColor('#185FA5',this)
    },
    "h0132": function (event) {
kpiSelectColor('#854F0B',this)
    },
    "h0133": function (event) {
kpiSelectColor('#6B21A8',this)
    },
    "h0134": function (event) {
kpiSelectColor('#0F6E56',this)
    },
    "h0135": function (event) {
kpiSelectColor('#DC2626',this)
    },
    "h0136": function (event) {
kpiSelectColor('#0369A1',this)
    },
    "h0137": function (event) {
kpiDeleteObjective()
    },
    "h0138": function (event) {
kpiSaveObjective()
    },
    "h0139": function (event) {
closeKpiModal('kpi-edit-modal')
    },
    "h0140": function (event) {
kpiAddIndicatorRow()
    },
    "h0141": function (event) {
kpiDeleteKPI()
    },
    "h0142": function (event) {
kpiSaveKPI()
    },
    "h0143": function (event) {
closeKpiModal('kpi-entry-modal')
    },
    "h0144": function (event) {
kpiClearEntry()
    },
    "h0145": function (event) {
kpiSaveEntry()
    },
    "h0146": function (event) {
wsSetView('week')
    },
    "h0147": function (event) {
wsSetView('list')
    },
    "h0148": function (event) {
wsNew()
    },
    "h0149": function (event) {
wsFilter()
    },
    "h0150": function (event) {
wsFilter()
    },
    "h0151": function (event) {
wsPrevWeek()
    },
    "h0152": function (event) {
wsNextWeek()
    },
    "h0153": function (event) {
wsThisWeek()
    },
    "h0154": function (event) {
wsShowList()
    },
    "h0155": function (event) {
wsEditCurrent()
    },
    "h0156": function (event) {
wsOpenToolboxTalk()
    },
    "h0157": function (event) {
event.stopPropagation();wsOpenToolboxTalk()
    },
    "h0158": function (event) {
wsOpenPreStart()
    },
    "h0159": function (event) {
event.stopPropagation();wsOpenPreStart()
    },
    "h0160": function (event) {
wsOpenSiteInspection()
    },
    "h0161": function (event) {
event.stopPropagation();wsOpenSiteInspection()
    },
    "h0162": function (event) {
wsOpenToolsCheck()
    },
    "h0163": function (event) {
event.stopPropagation();wsOpenToolsCheck()
    },
    "h0164": function (event) {
wsOpenRA()
    },
    "h0165": function (event) {
event.stopPropagation();wsOpenRA()
    },
    "h0166": function (event) {
wsOpenPTW()
    },
    "h0167": function (event) {
event.stopPropagation();wsOpenPTW()
    },
    "h0168": function (event) {
wsUpdateStatus(this.value)
    },
    "h0169": function (event) {
wsFormBack()
    },
    "h0170": function (event) {
wsDelete()
    },
    "h0171": function (event) {
wsSave()
    },
    "h0172": function (event) {
openVerifiedReferenceSelect('wsf-ra-ref','ra')
    },
    "h0173": function (event) {
openVerifiedReferenceSelect('wsf-ptw-ref','ptw')
    },
    "h0174": function (event) {
wsBackToDetail()
    },
    "h0175": function (event) {
tbtSave()
    },
    "h0176": function (event) {
if(event.key==='Enter')tbtAddAttendee()
    },
    "h0177": function (event) {
tbtAddAttendee()
    },
    "h0178": function (event) {
wsTEAddItem()
    },
    "h0179": function (event) {
wsTESearchEquipment()
    },
    "h0180": function (event) {
wsTESearchEquipment()
    },
    "h0181": function (event) {
wsBackToTEForm()
    },
    "h0182": function (event) {
wsChkSave()
    },
    "h0183": function (event) {
imsNewIncident()
    },
    "h0184": function (event) {
imsPrintIncident()
    },
    "h0185": function (event) {
imsSwitchTab('register',this)
    },
    "h0186": function (event) {
imsSwitchTab('report',this)
    },
    "h0187": function (event) {
imsSwitchTab('investigate',this)
    },
    "h0188": function (event) {
imsSwitchTab('actions',this)
    },
    "h0189": function (event) {
imsSwitchTab('evidence',this)
    },
    "h0190": function (event) {
imsSwitchTab('stats',this)
    },
    "h0191": function (event) {
imsFilterList()
    },
    "h0192": function (event) {
imsFilterList()
    },
    "h0193": function (event) {
imsBackToRegister()
    },
    "h0194": function (event) {
imsDelete()
    },
    "h0195": function (event) {
imsSave()
    },
    "h0196": function (event) {
imsStartInvestigation()
    },
    "h0197": function (event) {
imsSelectType('injury')
    },
    "h0198": function (event) {
imsSelectType('near_miss')
    },
    "h0199": function (event) {
imsSelectType('dangerous_occurrence')
    },
    "h0200": function (event) {
imsSelectType('property_damage')
    },
    "h0201": function (event) {
imsSelectType('environmental')
    },
    "h0202": function (event) {
imsSelectType('vehicle')
    },
    "h0203": function (event) {
imsSelectType('unsafe_act')
    },
    "h0204": function (event) {
imsSelectType('unsafe_condition')
    },
    "h0205": function (event) {
imsSelectType('fire')
    },
    "h0206": function (event) {
imsSelectType('occupational_disease')
    },
    "h0207": function (event) {
imsSelectType('security')
    },
    "h0208": function (event) {
aurisStartVoice('ev-description','incident')
    },
    "h0209": function (event) {
aurisPolishField('ev-description','incident')
    },
    "h0210": function (event) {
aurisStartVoice('ev-immediate','immediate')
    },
    "h0211": function (event) {
aurisPolishField('ev-immediate','immediate')
    },
    "h0212": function (event) {
imsPhotoSelected(this)
    },
    "h0213": function (event) {
imsClearPhotos()
    },
    "h0214": function (event) {
imsGetGPS()
    },
    "h0215": function (event) {
imsToggleInvReq()
    },
    "h0216": function (event) {
imsNewInvestigation()
    },
    "h0217": function (event) {
imsInvBack()
    },
    "h0218": function (event) {
invDeleteCurrent()
    },
    "h0219": function (event) {
invReleaseForEdit()
    },
    "h0220": function (event) {
invSave()
    },
    "h0221": function (event) {
invAIAssistInvestigation()
    },
    "h0222": function (event) {
invSelectMethod('5why')
    },
    "h0223": function (event) {
invSelectMethod('fishbone')
    },
    "h0224": function (event) {
invSelectMethod('icam')
    },
    "h0225": function (event) {
invSelectMethod('taproot')
    },
    "h0226": function (event) {
invSelectMethod('timeline')
    },
    "h0227": function (event) {
invShowTab('ws1',this)
    },
    "h0228": function (event) {
invShowTab('ws2',this)
    },
    "h0229": function (event) {
invShowTab('rca',this)
    },
    "h0230": function (event) {
invShowTab('ws3',this)
    },
    "h0231": function (event) {
invShowTab('ca',this)
    },
    "h0232": function (event) {
invShowTab('sign',this)
    },
    "h0233": function (event) {
if(event.key==='Enter'){event.preventDefault();invAddTeamMember();}
    },
    "h0234": function (event) {
invAddTeamMember()
    },
    "h0235": function (event) {
invAddWitnessRow()
    },
    "h0236": function (event) {
ws3AddRow()
    },
    "h0237": function (event) {
invAddTimelineRow()
    },
    "h0238": function (event) {
invAddCA()
    },
    "h0239": function (event) {
generateSafetyComm()
    },
    "h0240": function (event) {
invSign('investigator')
    },
    "h0241": function (event) {
invSign('reviewer')
    },
    "h0242": function (event) {
invSign('approver')
    },
    "h0243": function (event) {
imsLoadEvidence()
    },
    "h0244": function (event) {
imsNewEvidence()
    },
    "h0245": function (event) {
imsEvidenceBack()
    },
    "h0246": function (event) {
imsDeleteEvidence()
    },
    "h0247": function (event) {
imsEvidenceSave()
    },
    "h0248": function (event) {
appAttachFileToField(this,'ims-ev-url','ims-ev-filename')
    },
    "h0249": function (event) {
appPreviewFieldDocument('ims-ev-url','ims-ev-filename','Incident evidence')
    },
    "h0250": function (event) {
imsAskAI('Analyse our incident data and identify the top 3 recurring causes and patterns')
    },
    "h0251": function (event) {
imsAskAI('What preventive actions would most reduce our incident rate based on our data?')
    },
    "h0252": function (event) {
imsAskAI('Generate a management summary of our incident statistics and key findings')
    },
    "h0253": function (event) {
if(event.key==='Enter')imsAskAI(this.value)
    },
    "h0254": function (event) {
imsAskAI(document.getElementById('ims-ai-input').value)
    },
    "h0255": function (event) {
obsPrintCurrentView()
    },
    "h0256": function (event) {
obsNew()
    },
    "h0257": function (event) {
obsSwitchTab('list',this)
    },
    "h0258": function (event) {
obsSwitchTab('positive',this)
    },
    "h0259": function (event) {
obsSwitchTab('unsafe',this)
    },
    "h0260": function (event) {
obsSwitchTab('trends',this)
    },
    "h0261": function (event) {
obsFilterList()
    },
    "h0262": function (event) {
obsFilterList()
    },
    "h0263": function (event) {
obsAskAI('Analyse our safety observation data and identify the top 3 recurring unsafe behaviour patterns and their likely root causes')
    },
    "h0264": function (event) {
obsAskAI('Based on our observation categories, what targeted BBS interventions and toolbox talks would most reduce our unsafe behaviours?')
    },
    "h0265": function (event) {
obsAskAI('Write a brief safety observation programme summary report including trends and recommendations')
    },
    "h0266": function (event) {
if(event.key==='Enter')obsAskAI(this.value)
    },
    "h0267": function (event) {
obsAskAI(document.getElementById('obs-ai-input').value)
    },
    "h0268": function (event) {
obsShowList()
    },
    "h0269": function (event) {
obsDelete()
    },
    "h0270": function (event) {
obsSave()
    },
    "h0271": function (event) {
aurisStartVoice('obs-positive-text','bbs_positive')
    },
    "h0272": function (event) {
aurisPolishField('obs-positive-text','bbs_positive')
    },
    "h0273": function (event) {
obsUpdateScopeState()
    },
    "h0274": function (event) {
aurisStartVoice('obs-text','bbs_unsafe')
    },
    "h0275": function (event) {
aurisPolishField('obs-text','bbs_unsafe')
    },
    "h0276": function (event) {
aurisStartVoice('obs-condition-text','bbs_unsafe')
    },
    "h0277": function (event) {
aurisPolishField('obs-condition-text','bbs_unsafe')
    },
    "h0278": function (event) {
obsPhotoSelected(this)
    },
    "h0279": function (event) {
obsClearPhotos()
    },
    "h0280": function (event) {
aurisStartVoice('obs-immediate-desc','bbs_action')
    },
    "h0281": function (event) {
aurisPolishField('obs-immediate-desc','bbs_action')
    },
    "h0282": function (event) {
obsToggleAction()
    },
    "h0283": function (event) {
document.getElementById('obs-ppe-worn').value='true'
    },
    "h0284": function (event) {
document.getElementById('obs-ppe-worn').value='partial'
    },
    "h0285": function (event) {
document.getElementById('obs-ppe-worn').value='false'
    },
    "h0286": function (event) {
document.getElementById('obs-ppe-worn').value='na'
    },
    "h0287": function (event) {
obsObserverSelect()
    },
    "h0288": function (event) {
auditPrintCurrentView()
    },
    "h0289": function (event) {
auditStartFromCurrentTab()
    },
    "h0290": function (event) {
if(typeof auditEditId!=='undefined'&&auditEditId)printAuditReport(auditEditId);else toast('Open an audit first',false)
    },
    "h0291": function (event) {
auditSwitchTab('all',this)
    },
    "h0292": function (event) {
auditSwitchTab('workplace',this)
    },
    "h0293": function (event) {
auditSwitchTab('behavioral',this)
    },
    "h0294": function (event) {
auditSwitchTab('equipment',this)
    },
    "h0295": function (event) {
auditSwitchTab('ppe',this)
    },
    "h0296": function (event) {
auditSwitchTab('fire',this)
    },
    "h0297": function (event) {
auditSwitchTab('environmental',this)
    },
    "h0298": function (event) {
auditSwitchTab('audit',this)
    },
    "h0299": function (event) {
auditSwitchTab('prestart',this)
    },
    "h0300": function (event) {
auditSwitchTab('findings',this)
    },
    "h0301": function (event) {
auditFilter()
    },
    "h0302": function (event) {
auditFilter()
    },
    "h0303": function (event) {
psNew()
    },
    "h0304": function (event) {
psShowList()
    },
    "h0305": function (event) {
psDelete()
    },
    "h0306": function (event) {
psSave()
    },
    "h0307": function (event) {
findingsLoad()
    },
    "h0308": function (event) {
auditBackToList()
    },
    "h0309": function (event) {
auditDelete()
    },
    "h0310": function (event) {
auditAIAssistFindings()
    },
    "h0311": function (event) {
auditSave()
    },
    "h0312": function (event) {
auditSelectType('workplace')
    },
    "h0313": function (event) {
auditSelectType('behavioral')
    },
    "h0314": function (event) {
auditSelectType('equipment')
    },
    "h0315": function (event) {
auditSelectType('ppe')
    },
    "h0316": function (event) {
auditSelectType('fire')
    },
    "h0317": function (event) {
auditSelectType('environmental')
    },
    "h0318": function (event) {
auditSelectType('iso_audit')
    },
    "h0319": function (event) {
auditSelectType('internal_audit')
    },
    "h0320": function (event) {
auditSelectType('supplier_audit')
    },
    "h0321": function (event) {
auditSelectType('contractor_audit')
    },
    "h0322": function (event) {
auditSelectType('regulatory')
    },
    "h0323": function (event) {
auditLoadTemplate()
    },
    "h0324": function (event) {
auditAddChecklistRow()
    },
    "h0325": function (event) {
auditAddPhotoRow()
    },
    "h0326": function (event) {
inspAddAction()
    },
    "h0327": function (event) {
auditAddFinding()
    },
    "h0328": function (event) {
auditGetGPS()
    },
    "h0329": function (event) {
raShowLibrary()
    },
    "h0330": function (event) {
raImportExistingPDF('task')
    },
    "h0331": function (event) {
raPrintCurrentView()
    },
    "h0332": function (event) {
raShowNewPanel()
    },
    "h0333": function (event) {
if(raEditingId)printRiskAssessment(raEditingId);else toast('Open a risk assessment first',false)
    },
    "h0334": function (event) {
raListTab('ra',this)
    },
    "h0335": function (event) {
raListTab('jsa',this)
    },
    "h0336": function (event) {
raListTab('hira',this)
    },
    "h0337": function (event) {
raFilterList()
    },
    "h0338": function (event) {
raFilterList()
    },
    "h0339": function (event) {
raShowList()
    },
    "h0340": function (event) {
raNew('task')
    },
    "h0341": function (event) {
this.style.boxShadow='0 18px 45px rgba(29,158,117,.18)'
    },
    "h0342": function (event) {
this.style.boxShadow=''
    },
    "h0343": function (event) {
raAIGenerate()
    },
    "h0344": function (event) {
this.style.borderColor='#8B5CF6';this.style.background='#F5F3FF'
    },
    "h0345": function (event) {
this.style.borderColor='var(--border)';this.style.background='#fff'
    },
    "h0346": function (event) {
raNew('baseline')
    },
    "h0347": function (event) {
this.style.borderColor='#185FA5';this.style.background='#EFF6FF'
    },
    "h0348": function (event) {
raNew('dynamic')
    },
    "h0349": function (event) {
this.style.borderColor='#EF9F27';this.style.background='#FFFBEB'
    },
    "h0350": function (event) {
raNew('hira')
    },
    "h0351": function (event) {
this.style.borderColor='#E24B4A';this.style.background='#FEF2F2'
    },
    "h0352": function (event) {
jsaNew()
    },
    "h0353": function (event) {
this.style.borderColor='#6D28D9';this.style.background='#F5F3FF'
    },
    "h0354": function (event) {
raManualHandlingNew()
    },
    "h0355": function (event) {
this.style.borderColor='#0F766E';this.style.background='#ECFDF5'
    },
    "h0356": function (event) {
raSpecificNew('fire')
    },
    "h0357": function (event) {
this.style.borderColor='#DC2626';this.style.background='#FEF2F2'
    },
    "h0358": function (event) {
raSpecificNew('machinery')
    },
    "h0359": function (event) {
raSpecificNew('chemical')
    },
    "h0360": function (event) {
this.style.borderColor='#7C3AED';this.style.background='#F5F3FF'
    },
    "h0361": function (event) {
raSpecificNew('atex')
    },
    "h0362": function (event) {
this.style.borderColor='#B45309';this.style.background='#FFFBEB'
    },
    "h0363": function (event) {
raSpecificNew('fleet')
    },
    "h0364": function (event) {
raManualCreateRA()
    },
    "h0365": function (event) {
raManualUpdatePreview()
    },
    "h0366": function (event) {
raManualUpdatePreview()
    },
    "h0367": function (event) {
raSpecificCreateRA()
    },
    "h0368": function (event) {
raUpdateQualityPanel()
    },
    "h0369": function (event) {
raUpdateQualityPanel()
    },
    "h0370": function (event) {
raDeleteCurrent()
    },
    "h0371": function (event) {
raSave('draft')
    },
    "h0372": function (event) {
raSave('pending_review')
    },
    "h0373": function (event) {
raFormTab('info',this)
    },
    "h0374": function (event) {
raFormTab('hazards',this)
    },
    "h0375": function (event) {
raFormTab('approval',this)
    },
    "h0376": function (event) {
raFormTab('rams',this)
    },
    "h0377": function (event) {
raFormTab('revisions',this)
    },
    "h0378": function (event) {
raAISuggest()
    },
    "h0379": function (event) {
raShowHazardLibPicker()
    },
    "h0380": function (event) {
raSearchHazardLib()
    },
    "h0381": function (event) {
raBaselineAddRow()
    },
    "h0382": function (event) {
raTaskAddRow()
    },
    "h0383": function (event) {
raDynamicAddRow()
    },
    "h0384": function (event) {
raApproveCurrent()
    },
    "h0385": function (event) {
raRejectCurrent()
    },
    "h0386": function (event) {
raReleaseForEdit()
    },
    "h0387": function (event) {
raHandleRAMSUpload(this)
    },
    "h0388": function (event) {
document.getElementById('ra-rams-file').click()
    },
    "h0389": function (event) {
raRenderRamsUsed()
    },
    "h0390": function (event) {
raRenderRamsUsed()
    },
    "h0391": function (event) {
raPreviewRamsDocument()
    },
    "h0392": function (event) {
if(event.key==='Enter')raAddLegalRef()
    },
    "h0393": function (event) {
raAddLegalRef()
    },
    "h0394": function (event) {
raAddLegalRefText('OSH Act 2005 - s.14 General duties of employer')
    },
    "h0395": function (event) {
raAddLegalRefText('OSH (Work at Height) Regs 2012')
    },
    "h0396": function (event) {
raAddLegalRefText('OSH (Scaffolds) Regs 1973')
    },
    "h0397": function (event) {
raAddLegalRefText('OSH (Noise at Work) Regs 2012')
    },
    "h0398": function (event) {
raAddLegalRefText('OSH (Electrical) Regs')
    },
    "h0399": function (event) {
raAddLegalRefText('OSH (PPE) Regs')
    },
    "h0400": function (event) {
raAddLegalRefText('First Aid Regs 1989')
    },
    "h0401": function (event) {
raAddLegalRefText('ISO 45001:2018 - cl.6.1 Risk assessment')
    },
    "h0402": function (event) {
raCreateRevision()
    },
    "h0403": function (event) {
jsaFormBack()
    },
    "h0404": function (event) {
jsaSave()
    },
    "h0405": function (event) {
jsaAISuggestSteps()
    },
    "h0406": function (event) {
jsaAddStep()
    },
    "h0407": function (event) {
libTab('hazards',this)
    },
    "h0408": function (event) {
libTab('controls',this)
    },
    "h0409": function (event) {
libTab('templates',this)
    },
    "h0410": function (event) {
libHazardImportFile(this.files[0]);this.value=''
    },
    "h0411": function (event) {
document.getElementById('lib-hazard-import-file').click()
    },
    "h0412": function (event) {
libHazardNew()
    },
    "h0413": function (event) {
libControlNew()
    },
    "h0414": function (event) {
chemPrintRegister()
    },
    "h0415": function (event) {
chemNew()
    },
    "h0416": function (event) {
chemRenderTable()
    },
    "h0417": function (event) {
chemRenderTable()
    },
    "h0418": function (event) {
chemBack()
    },
    "h0419": function (event) {
chemDelete()
    },
    "h0420": function (event) {
chemSave()
    },
    "h0421": function (event) {
chemParseSdsFile(this.files&&this.files[0])
    },
    "h0422": function (event) {
chemUpdateRiskPreview()
    },
    "h0423": function (event) {
chemUpdateRiskPreview()
    },
    "h0424": function (event) {
chemRecommend()
    },
    "h0425": function (event) {
chemAIExposureReview()
    },
    "h0426": function (event) {
legalPrintCurrentView()
    },
    "h0427": function (event) {
legalNewFromTab()
    },
    "h0428": function (event) {
legalSwitchTab('register',this)
    },
    "h0429": function (event) {
legalSwitchTab('changes',this)
    },
    "h0430": function (event) {
legalSwitchTab('assessments',this)
    },
    "h0431": function (event) {
legalSwitchTab('gaps',this)
    },
    "h0432": function (event) {
legalSwitchTab('calendar',this)
    },
    "h0433": function (event) {
legalSwitchTab('dashboard',this)
    },
    "h0434": function (event) {
legalFilterRegister()
    },
    "h0435": function (event) {
legalFilterRegister()
    },
    "h0436": function (event) {
legalOpenPdfImport()
    },
    "h0437": function (event) {
legalParsePdfFile(this.files&&this.files[0])
    },
    "h0438": function (event) {
legalNewRequirement()
    },
    "h0439": function (event) {
legalCancelPdfImport()
    },
    "h0440": function (event) {
document.getElementById('lr-pdf-input').click()
    },
    "h0441": function (event) {
legalNewChange()
    },
    "h0442": function (event) {
legalRenderChanges()
    },
    "h0443": function (event) {
legalRenderChanges()
    },
    "h0444": function (event) {
legalClearChangeFilters()
    },
    "h0445": function (event) {
lcaNew()
    },
    "h0446": function (event) {
gapLoad()
    },
    "h0447": function (event) {
gapNew()
    },
    "h0448": function (event) {
calFilter('overdue',this)
    },
    "h0449": function (event) {
calFilter('30',this)
    },
    "h0450": function (event) {
calFilter('90',this)
    },
    "h0451": function (event) {
calFilter('all',this)
    },
    "h0452": function (event) {
calNew()
    },
    "h0453": function (event) {
legalAskAI('Summarise our current compliance status and top 3 priority gaps')
    },
    "h0454": function (event) {
legalAskAI('What are the key requirements of the OSH Act 2005 Mauritius that apply to our organisation?')
    },
    "h0455": function (event) {
legalAskAI('What actions should we take to close our non-compliance gaps and improve our compliance score?')
    },
    "h0456": function (event) {
legalAskAI('List the main ISO 45001:2018 clauses and their compliance requirements for a Mauritius company')
    },
    "h0457": function (event) {
if(event.key==='Enter')legalAskAI(this.value)
    },
    "h0458": function (event) {
legalAskAI(document.getElementById('legal-ai-input').value)
    },
    "h0459": function (event) {
legalReqBack()
    },
    "h0460": function (event) {
legalEditReq()
    },
    "h0461": function (event) {
legalDeleteReq()
    },
    "h0462": function (event) {
legalAIAssessRequirement()
    },
    "h0463": function (event) {
legalSaveReq()
    },
    "h0464": function (event) {
legalSetStatus('compliant')
    },
    "h0465": function (event) {
legalSetStatus('partial')
    },
    "h0466": function (event) {
legalSetStatus('non_compliant')
    },
    "h0467": function (event) {
legalSetStatus('not_applicable')
    },
    "h0468": function (event) {
legalScoreUpdate(this.value)
    },
    "h0469": function (event) {
legalChgBack()
    },
    "h0470": function (event) {
legalPrintChange()
    },
    "h0471": function (event) {
legalEditChg()
    },
    "h0472": function (event) {
legalDeleteChg()
    },
    "h0473": function (event) {
legalSaveChg()
    },
    "h0474": function (event) {
legalChangeSectionChanged()
    },
    "h0475": function (event) {
lcaBack()
    },
    "h0476": function (event) {
lcaDelete()
    },
    "h0477": function (event) {
lcaSave()
    },
    "h0478": function (event) {
gapBack()
    },
    "h0479": function (event) {
gapDelete()
    },
    "h0480": function (event) {
gapSave()
    },
    "h0481": function (event) {
document.getElementById('gapf-status').value='open'
    },
    "h0482": function (event) {
document.getElementById('gapf-status').value='in_progress'
    },
    "h0483": function (event) {
document.getElementById('gapf-status').value='closed'
    },
    "h0484": function (event) {
document.getElementById('gapf-status').value='accepted_risk'
    },
    "h0485": function (event) {
calBack()
    },
    "h0486": function (event) {
calDelete()
    },
    "h0487": function (event) {
calSave()
    },
    "h0488": function (event) {
calOpenLinked('legal')
    },
    "h0489": function (event) {
calOpenLinked('action')
    },
    "h0490": function (event) {
fleetPrintRegister()
    },
    "h0491": function (event) {
fleetNewVehicle()
    },
    "h0492": function (event) {
fleetFuelNew('')
    },
    "h0493": function (event) {
fleetRender()
    },
    "h0494": function (event) {
fleetRender()
    },
    "h0495": function (event) {
atexPrintRegister()
    },
    "h0496": function (event) {
atexNew()
    },
    "h0497": function (event) {
atexRender()
    },
    "h0498": function (event) {
atexRender()
    },
    "h0499": function (event) {
atexBack()
    },
    "h0500": function (event) {
atexDelete()
    },
    "h0501": function (event) {
atexSave()
    },
    "h0502": function (event) {
toolsPrintCurrentView()
    },
    "h0503": function (event) {
toolsNew()
    },
    "h0504": function (event) {
toolsSwitchTab('register',this)
    },
    "h0505": function (event) {
toolsSwitchTab('personal',this)
    },
    "h0506": function (event) {
toolsSwitchTab('inspection',this)
    },
    "h0507": function (event) {
toolsSwitchTab('lifting',this)
    },
    "h0508": function (event) {
toolsSwitchTab('statutory',this)
    },
    "h0509": function (event) {
toolsSwitchTab('vehicles',this)
    },
    "h0510": function (event) {
toolsSwitchTab('rcd',this)
    },
    "h0511": function (event) {
toolsFilterRegister()
    },
    "h0512": function (event) {
toolsFilterRegister()
    },
    "h0513": function (event) {
toolsLoadPersonal()
    },
    "h0514": function (event) {
toolsNewInspection()
    },
    "h0515": function (event) {
toolsNewLiftingAccessory()
    },
    "h0516": function (event) {
toolsNewVehicleInspection()
    },
    "h0517": function (event) {
toolsNewRCD()
    },
    "h0518": function (event) {
toolsFormBack()
    },
    "h0519": function (event) {
toolsDelete()
    },
    "h0520": function (event) {
toolsSaveEquipment()
    },
    "h0521": function (event) {
toolsCatChange()
    },
    "h0522": function (event) {
toolsStatutoryChange()
    },
    "h0523": function (event) {
toolsInspFormBack()
    },
    "h0524": function (event) {
toolsSaveInspection()
    },
    "h0525": function (event) {
toolsRCDBack()
    },
    "h0526": function (event) {
toolsSaveRCDTest()
    },
    "h0527": function (event) {
ptwFilterSet('active',this)
    },
    "h0528": function (event) {
ptwFilterSet('all',this)
    },
    "h0529": function (event) {
ptwPrintRegister()
    },
    "h0530": function (event) {
if(typeof ptwCurrentId!=='undefined'&&ptwCurrentId)printPermit(ptwCurrentId);else toast('Open a permit first',false)
    },
    "h0531": function (event) {
ptwNew()
    },
    "h0532": function (event) {
ptwRenderList()
    },
    "h0533": function (event) {
ptwRenderList()
    },
    "h0534": function (event) {
ptwShowList()
    },
    "h0535": function (event) {
ptwEditCurrent()
    },
    "h0536": function (event) {
ptwDetailTab('details',this)
    },
    "h0537": function (event) {
ptwDetailTab('checks',this)
    },
    "h0538": function (event) {
ptwDetailTab('gas',this)
    },
    "h0539": function (event) {
ptwDetailTab('isolation',this)
    },
    "h0540": function (event) {
ptwDetailTab('approval',this)
    },
    "h0541": function (event) {
ptwDetailTab('log',this)
    },
    "h0542": function (event) {
ptwFormBack()
    },
    "h0543": function (event) {
ptwDelete()
    },
    "h0544": function (event) {
ptwAIAssist()
    },
    "h0545": function (event) {
ptwSave('draft')
    },
    "h0546": function (event) {
ptwSave('pending_approval')
    },
    "h0547": function (event) {
ptwSelectType('hot_work')
    },
    "h0548": function (event) {
this.style.background='#FECACA'
    },
    "h0549": function (event) {
ptwTypeCardHover(this)
    },
    "h0550": function (event) {
ptwSelectType('confined_space')
    },
    "h0551": function (event) {
this.style.background='#EDE9FE'
    },
    "h0552": function (event) {
ptwSelectType('excavation')
    },
    "h0553": function (event) {
this.style.background='#FEF3C7'
    },
    "h0554": function (event) {
ptwSelectType('electrical_isolation')
    },
    "h0555": function (event) {
this.style.background='#DBEAFE'
    },
    "h0556": function (event) {
ptwSelectType('loto')
    },
    "h0557": function (event) {
ptwSelectType('work_at_height')
    },
    "h0558": function (event) {
this.style.background='#D1FAE5'
    },
    "h0559": function (event) {
ptwSelectType('lifting_operation')
    },
    "h0560": function (event) {
ptwSelectType('line_breaking')
    },
    "h0561": function (event) {
this.style.background='#FFE4E6'
    },
    "h0562": function (event) {
ptwSelectType('radiation')
    },
    "h0563": function (event) {
ptwSelectType('chemical_handling')
    },
    "h0564": function (event) {
ptwReceiverChanged()
    },
    "h0565": function (event) {
openVerifiedReferenceSelect('pf-ra-ref','ra')
    },
    "h0566": function (event) {
openVerifiedReferenceSelect('pf-ms-ref','document')
    },
    "h0567": function (event) {
openVerifiedReferenceSelect('pf-wo','work')
    },
    "h0568": function (event) {
ptwGasBack()
    },
    "h0569": function (event) {
ptwUpdateGasResultPreview()
    },
    "h0570": function (event) {
ptwAddGasTest()
    },
    "h0571": function (event) {
ptwIsolationBack()
    },
    "h0572": function (event) {
ptwAddIsolation()
    },
    "h0573": function (event) {
ptwApprovalBack()
    },
    "h0574": function (event) {
ptwClosureBack()
    },
    "h0575": function (event) {
ptwConfirmClose()
    },
    "h0576": function (event) {
ptwSuspendBack()
    },
    "h0577": function (event) {
ptwConfirmSuspend()
    },
    "h0578": function (event) {
contractorPrintCurrentView()
    },
    "h0579": function (event) {
conNew()
    },
    "h0580": function (event) {
conSwitchTab('register',this)
    },
    "h0581": function (event) {
conSwitchTab('score',this)
    },
    "h0582": function (event) {
conSwitchTab('preassess',this)
    },
    "h0583": function (event) {
conSwitchTab('eval',this)
    },
    "h0584": function (event) {
conSwitchTab('atw',this)
    },
    "h0585": function (event) {
conSwitchTab('incidents',this)
    },
    "h0586": function (event) {
conFilterRegister()
    },
    "h0587": function (event) {
conFilterRegister()
    },
    "h0588": function (event) {
conLoadSafetyScore()
    },
    "h0589": function (event) {
cpaNew()
    },
    "h0590": function (event) {
cevNew()
    },
    "h0591": function (event) {
catwNew()
    },
    "h0592": function (event) {
cirNew()
    },
    "h0593": function (event) {
conFormBack()
    },
    "h0594": function (event) {
conDelete()
    },
    "h0595": function (event) {
conSave()
    },
    "h0596": function (event) {
cpaFormBack()
    },
    "h0597": function (event) {
cpaSave()
    },
    "h0598": function (event) {
cevFormBack()
    },
    "h0599": function (event) {
cevSave()
    },
    "h0600": function (event) {
catwFormBack()
    },
    "h0601": function (event) {
catwDelete()
    },
    "h0602": function (event) {
catwSave()
    },
    "h0603": function (event) {
catwAddPerson()
    },
    "h0604": function (event) {
cirFormBack()
    },
    "h0605": function (event) {
cirDelete()
    },
    "h0606": function (event) {
cirSave()
    },
    "h0607": function (event) {
esgPrintCurrentView()
    },
    "h0608": function (event) {
esgSwitchTab('dash',this)
    },
    "h0609": function (event) {
esgSwitchTab('waste',this)
    },
    "h0610": function (event) {
esgSwitchTab('hazwaste',this)
    },
    "h0611": function (event) {
esgSwitchTab('fuel',this)
    },
    "h0612": function (event) {
esgSwitchTab('water',this)
    },
    "h0613": function (event) {
esgSwitchTab('spills',this)
    },
    "h0614": function (event) {
esgSwitchTab('inspections',this)
    },
    "h0615": function (event) {
esgLoadWaste()
    },
    "h0616": function (event) {
esgWasteNew()
    },
    "h0617": function (event) {
esgHWNew()
    },
    "h0618": function (event) {
esgLoadFuel()
    },
    "h0619": function (event) {
esgFuelNew()
    },
    "h0620": function (event) {
esgWaterNew()
    },
    "h0621": function (event) {
esgSpillNew()
    },
    "h0622": function (event) {
esgInspNew()
    },
    "h0623": function (event) {
esgWasteBack()
    },
    "h0624": function (event) {
esgWasteSave()
    },
    "h0625": function (event) {
esgHWBack()
    },
    "h0626": function (event) {
esgHWSave()
    },
    "h0627": function (event) {
esgFuelBack()
    },
    "h0628": function (event) {
esgFuelSave()
    },
    "h0629": function (event) {
esgCalcCO2()
    },
    "h0630": function (event) {
esgCalcCO2()
    },
    "h0631": function (event) {
esgWaterBack()
    },
    "h0632": function (event) {
esgWaterSave()
    },
    "h0633": function (event) {
esgCalcWater()
    },
    "h0634": function (event) {
esgSpillBack()
    },
    "h0635": function (event) {
esgSpillSave()
    },
    "h0636": function (event) {
esgInspBack()
    },
    "h0637": function (event) {
esgInspSave()
    },
    "h0638": function (event) {
emPrintCurrentView()
    },
    "h0639": function (event) {
emSwitchTab('dash',this)
    },
    "h0640": function (event) {
emSwitchTab('plans',this)
    },
    "h0641": function (event) {
emSwitchTab('ert',this)
    },
    "h0642": function (event) {
emSwitchTab('muster',this)
    },
    "h0643": function (event) {
emSwitchTab('drills',this)
    },
    "h0644": function (event) {
emSwitchTab('activations',this)
    },
    "h0645": function (event) {
emSwitchTab('bcp',this)
    },
    "h0646": function (event) {
emSwitchTab('equipment',this)
    },
    "h0647": function (event) {
emActivateEmergency()
    },
    "h0648": function (event) {
emPlanNew()
    },
    "h0649": function (event) {
ertNew()
    },
    "h0650": function (event) {
musterNew()
    },
    "h0651": function (event) {
drillNew()
    },
    "h0652": function (event) {
activationNew()
    },
    "h0653": function (event) {
bcpNew()
    },
    "h0654": function (event) {
emEqLoad()
    },
    "h0655": function (event) {
emEqNew()
    },
    "h0656": function (event) {
emPlanBack()
    },
    "h0657": function (event) {
emPlanDelete()
    },
    "h0658": function (event) {
emPlanSave()
    },
    "h0659": function (event) {
emPlanAddContact()
    },
    "h0660": function (event) {
emPlanAddResource()
    },
    "h0661": function (event) {
ertBack()
    },
    "h0662": function (event) {
ertDelete()
    },
    "h0663": function (event) {
ertSave()
    },
    "h0664": function (event) {
emergencyErtPersonSelect()
    },
    "h0665": function (event) {
musterBack()
    },
    "h0666": function (event) {
musterDelete()
    },
    "h0667": function (event) {
musterSave()
    },
    "h0668": function (event) {
drillBack()
    },
    "h0669": function (event) {
drillDelete()
    },
    "h0670": function (event) {
drillSave()
    },
    "h0671": function (event) {
document.getElementById('drf-rating').value='excellent';emHighlightRating(this,'#EAF3DE')
    },
    "h0672": function (event) {
document.getElementById('drf-rating').value='good';emHighlightRating(this,'#E6F1FB')
    },
    "h0673": function (event) {
document.getElementById('drf-rating').value='satisfactory';emHighlightRating(this,'#FEF9EC')
    },
    "h0674": function (event) {
document.getElementById('drf-rating').value='needs_improvement';emHighlightRating(this,'#FEF6E7')
    },
    "h0675": function (event) {
document.getElementById('drf-rating').value='failed';emHighlightRating(this,'#FCEBEB')
    },
    "h0676": function (event) {
activationBack()
    },
    "h0677": function (event) {
activationDelete()
    },
    "h0678": function (event) {
activationSave()
    },
    "h0679": function (event) {
bcpBack()
    },
    "h0680": function (event) {
bcpDelete()
    },
    "h0681": function (event) {
bcpSave()
    },
    "h0682": function (event) {
emEqBack()
    },
    "h0683": function (event) {
emEqDelete()
    },
    "h0684": function (event) {
emEqSave()
    },
    "h0685": function (event) {
ohPrintCurrentView()
    },
    "h0686": function (event) {
ohSwitchTab('dash',this)
    },
    "h0687": function (event) {
ohSwitchTab('surveillance',this)
    },
    "h0688": function (event) {
ohSwitchTab('audiometry',this)
    },
    "h0689": function (event) {
ohSwitchTab('spirometry',this)
    },
    "h0690": function (event) {
ohSwitchTab('vaccination',this)
    },
    "h0691": function (event) {
ohSwitchTab('exposure',this)
    },
    "h0692": function (event) {
ohSwitchTab('disease',this)
    },
    "h0693": function (event) {
ohMsLoad()
    },
    "h0694": function (event) {
msNew()
    },
    "h0695": function (event) {
audNew()
    },
    "h0696": function (event) {
spiNew()
    },
    "h0697": function (event) {
vaxLoad()
    },
    "h0698": function (event) {
vaxNew()
    },
    "h0699": function (event) {
expLoad()
    },
    "h0700": function (event) {
expNew()
    },
    "h0701": function (event) {
odNew()
    },
    "h0702": function (event) {
msBack()
    },
    "h0703": function (event) {
msDelete()
    },
    "h0704": function (event) {
msSave()
    },
    "h0705": function (event) {
healthPersonSelect('msf')
    },
    "h0706": function (event) {
msCalcBMI()
    },
    "h0707": function (event) {
document.getElementById('msf-fitness').value='fit'
    },
    "h0708": function (event) {
document.getElementById('msf-fitness').value='fit_with_restrictions'
    },
    "h0709": function (event) {
document.getElementById('msf-fitness').value='temporarily_unfit'
    },
    "h0710": function (event) {
document.getElementById('msf-fitness').value='permanently_unfit'
    },
    "h0711": function (event) {
audBack()
    },
    "h0712": function (event) {
audDelete()
    },
    "h0713": function (event) {
audSave()
    },
    "h0714": function (event) {
healthPersonSelect('audf')
    },
    "h0715": function (event) {
audCalcResult('r')
    },
    "h0716": function (event) {
audCalcResult('l')
    },
    "h0717": function (event) {
spiBack()
    },
    "h0718": function (event) {
spiDelete()
    },
    "h0719": function (event) {
spiSave()
    },
    "h0720": function (event) {
healthPersonSelect('spif')
    },
    "h0721": function (event) {
spiCalc()
    },
    "h0722": function (event) {
vaxBack()
    },
    "h0723": function (event) {
vaxDelete()
    },
    "h0724": function (event) {
vaxSave()
    },
    "h0725": function (event) {
healthPersonSelect('vaxf')
    },
    "h0726": function (event) {
expBack()
    },
    "h0727": function (event) {
expDelete()
    },
    "h0728": function (event) {
expSave()
    },
    "h0729": function (event) {
expUpdateTypeForm()
    },
    "h0730": function (event) {
expCalcRisk()
    },
    "h0731": function (event) {
odBack()
    },
    "h0732": function (event) {
odDelete()
    },
    "h0733": function (event) {
odSave()
    },
    "h0734": function (event) {
healthPersonSelect('odf')
    },
    "h0735": function (event) {
ppeSwitchTab('dash',this)
    },
    "h0736": function (event) {
ppeSwitchTab('catalogue',this)
    },
    "h0737": function (event) {
ppeSwitchTab('inventory',this)
    },
    "h0738": function (event) {
ppeSwitchTab('issuance',this)
    },
    "h0739": function (event) {
ppeSwitchTab('inspections',this)
    },
    "h0740": function (event) {
ppeSwitchTab('replacements',this)
    },
    "h0741": function (event) {
ppeSwitchTab('expiry',this)
    },
    "h0742": function (event) {
ppeLoadCatalogue()
    },
    "h0743": function (event) {
ppeCatNew()
    },
    "h0744": function (event) {
ppeLoadInventory()
    },
    "h0745": function (event) {
ppeLoadIssuance()
    },
    "h0746": function (event) {
ppeLoadIssuance()
    },
    "h0747": function (event) {
ppeIssNew()
    },
    "h0748": function (event) {
ppeInspNew()
    },
    "h0749": function (event) {
ppeRepNew()
    },
    "h0750": function (event) {
ppeExpiryFilter(30,this)
    },
    "h0751": function (event) {
ppeExpiryFilter(60,this)
    },
    "h0752": function (event) {
ppeExpiryFilter(90,this)
    },
    "h0753": function (event) {
ppeExpiryFilter(0,this)
    },
    "h0754": function (event) {
ppeCatBack()
    },
    "h0755": function (event) {
ppeCatDelete()
    },
    "h0756": function (event) {
ppeCatSave()
    },
    "h0757": function (event) {
appAttachFileToField(this,'pcf-cert-url')
    },
    "h0758": function (event) {
appPreviewFieldDocument('pcf-cert-url',null,document.getElementById('pcf-cert-ref')?.value||'PPE certificate')
    },
    "h0759": function (event) {
ppeIssBack()
    },
    "h0760": function (event) {
ppeIssDelete()
    },
    "h0761": function (event) {
ppeIssSave()
    },
    "h0762": function (event) {
ppeIssSelectItem()
    },
    "h0763": function (event) {
ppeIssPersonSelect()
    },
    "h0764": function (event) {
openVerifiedReferenceSelect('pif-wo-ref','work')
    },
    "h0765": function (event) {
openVerifiedReferenceSelect('pif-ra-ref','ra')
    },
    "h0766": function (event) {
ppeIssToggleReturn()
    },
    "h0767": function (event) {
ppeInspBack()
    },
    "h0768": function (event) {
ppeInspDelete()
    },
    "h0769": function (event) {
ppeInspSave()
    },
    "h0770": function (event) {
ppeInspSelectItem()
    },
    "h0771": function (event) {
ppeInspPersonSelect()
    },
    "h0772": function (event) {
document.getElementById('piif-result').value='pass'
    },
    "h0773": function (event) {
document.getElementById('piif-result').value='monitor'
    },
    "h0774": function (event) {
document.getElementById('piif-result').value='fail'
    },
    "h0775": function (event) {
document.getElementById('piif-result').value='condemn'
    },
    "h0776": function (event) {
ppeRepBack()
    },
    "h0777": function (event) {
ppeRepDelete()
    },
    "h0778": function (event) {
ppeRepSave()
    },
    "h0779": function (event) {
ppeRepPersonSelect()
    },
    "h0780": function (event) {
document.getElementById('prf-status').value='pending'
    },
    "h0781": function (event) {
document.getElementById('prf-status').value='approved'
    },
    "h0782": function (event) {
document.getElementById('prf-status').value='fulfilled'
    },
    "h0783": function (event) {
document.getElementById('prf-status').value='rejected'
    },
    "h0784": function (event) {
noisePrintRegister()
    },
    "h0785": function (event) {
noiseNewSurvey()
    },
    "h0786": function (event) {
deleteNoiseSurvey(window.noiseEditId)
    },
    "h0787": function (event) {
noisePrintCurrentSurvey()
    },
    "h0788": function (event) {
saveNoise()
    },
    "h0789": function (event) {
toggleForm('noise-form')
    },
    "h0790": function (event) {
noiseSwitchSection('details')
    },
    "h0791": function (event) {
noiseSwitchSection('map')
    },
    "h0792": function (event) {
noiseSwitchSection('hpe')
    },
    "h0793": function (event) {
noiseUploadPlan(this)
    },
    "h0794": function (event) {
noiseSetActivePoint(this.value)
    },
    "h0795": function (event) {
noisePlanClick(event)
    },
    "h0796": function (event) {
noiseAddPoint()
    },
    "h0797": function (event) {
mtgPrintCurrentView()
    },
    "h0798": function (event) {
mtgNewSeries()
    },
    "h0799": function (event) {
mtgSwitchTab('schedule',this)
    },
    "h0800": function (event) {
mtgSwitchTab('minutes',this)
    },
    "h0801": function (event) {
mtgSwitchTab('tbt',this)
    },
    "h0802": function (event) {
mtgSwitchTab('alerts',this)
    },
    "h0803": function (event) {
mtgSwitchTab('bulletins',this)
    },
    "h0804": function (event) {
mtgRoadmapPrevYear()
    },
    "h0805": function (event) {
mtgRoadmapNextYear()
    },
    "h0806": function (event) {
mtgRoadmapToday()
    },
    "h0807": function (event) {
mtgToggleSeriesList()
    },
    "h0808": function (event) {
tbtLoad()
    },
    "h0809": function (event) {
tbtNew()
    },
    "h0810": function (event) {
alertLoad()
    },
    "h0811": function (event) {
alertNew()
    },
    "h0812": function (event) {
bulletinLoad()
    },
    "h0813": function (event) {
bulletinNew()
    },
    "h0814": function (event) {
tbtBack()
    },
    "h0815": function (event) {
tbtDelete()
    },
    "h0816": function (event) {
printToolboxTalk(tbtEditId)
    },
    "h0817": function (event) {
tbtAIGenerateDraft()
    },
    "h0818": function (event) {
tbtAddAction()
    },
    "h0819": function (event) {
alertBack()
    },
    "h0820": function (event) {
alertDelete()
    },
    "h0821": function (event) {
alertSave()
    },
    "h0822": function (event) {
bulletinBack()
    },
    "h0823": function (event) {
bulletinDelete()
    },
    "h0824": function (event) {
bulletinSave()
    },
    "h0825": function (event) {
bulletinUploadAttachment(this)
    },
    "h0826": function (event) {
bulletinPreviewCurrent()
    },
    "h0827": function (event) {
bulletinMarkCheckedCurrent()
    },
    "h0828": function (event) {
mtgSeriesBack()
    },
    "h0829": function (event) {
mtgDeleteSeries()
    },
    "h0830": function (event) {
mtgSaveSeries()
    },
    "h0831": function (event) {
mtgMomBack()
    },
    "h0832": function (event) {
mtgDeleteMom()
    },
    "h0833": function (event) {
mtgSendMinutes()
    },
    "h0834": function (event) {
mtgPrintMom()
    },
    "h0835": function (event) {
mtgSaveMom()
    },
    "h0836": function (event) {
document.getElementById('mom3header-title').textContent=this.value||'HSE Meeting'
    },
    "h0837": function (event) {
momAddAttendee()
    },
    "h0838": function (event) {
momAddApology()
    },
    "h0839": function (event) {
mtgAddAgendaItem()
    },
    "h0840": function (event) {
this.parentNode.parentNode.remove()
    },
    "h0841": function (event) {
mtgAddRec()
    },
    "h0842": function (event) {
trainingPrintCurrentView()
    },
    "h0843": function (event) {
trainNewFromTab()
    },
    "h0844": function (event) {
trainSwitchTab('matrix',this)
    },
    "h0845": function (event) {
trainSwitchTab('competency',this)
    },
    "h0846": function (event) {
trainSwitchTab('induction',this)
    },
    "h0847": function (event) {
trainSwitchTab('plan',this)
    },
    "h0848": function (event) {
trainSwitchTab('followup',this)
    },
    "h0849": function (event) {
trainSwitchTab('elearning',this)
    },
    "h0850": function (event) {
trainSwitchTab('auth',this)
    },
    "h0851": function (event) {
trainSwitchTab('tna',this)
    },
    "h0852": function (event) {
cmLoad()
    },
    "h0853": function (event) {
cmAddCompetency()
    },
    "h0854": function (event) {
compFilter()
    },
    "h0855": function (event) {
compFilter()
    },
    "h0856": function (event) {
compNew()
    },
    "h0857": function (event) {
indLoad()
    },
    "h0858": function (event) {
indNew()
    },
    "h0859": function (event) {
trainPlanPrevYear()
    },
    "h0860": function (event) {
trainPlanNextYear()
    },
    "h0861": function (event) {
trainingAIGapReview()
    },
    "h0862": function (event) {
tpNew()
    },
    "h0863": function (event) {
tfFilter()
    },
    "h0864": function (event) {
tfFilter()
    },
    "h0865": function (event) {
tfNew()
    },
    "h0866": function (event) {
elcNew()
    },
    "h0867": function (event) {
eleNew()
    },
    "h0868": function (event) {
authFilter()
    },
    "h0869": function (event) {
authFilter()
    },
    "h0870": function (event) {
authNew()
    },
    "h0871": function (event) {
tnaAddRow()
    },
    "h0872": function (event) {
tpBack()
    },
    "h0873": function (event) {
tpDelete()
    },
    "h0874": function (event) {
tpSave()
    },
    "h0875": function (event) {
tfBack()
    },
    "h0876": function (event) {
tfDelete()
    },
    "h0877": function (event) {
tfSave()
    },
    "h0878": function (event) {
tfPersonSelect()
    },
    "h0879": function (event) {
appAttachFileToField(this,'tfr-cert-url')
    },
    "h0880": function (event) {
appPreviewFieldDocument('tfr-cert-url',null,document.getElementById('tfr-cert')?.value||'Training certificate')
    },
    "h0881": function (event) {
compBack()
    },
    "h0882": function (event) {
compDelete()
    },
    "h0883": function (event) {
compSave()
    },
    "h0884": function (event) {
trainingPersonSelect('compf')
    },
    "h0885": function (event) {
compSelectComp()
    },
    "h0886": function (event) {
indBack()
    },
    "h0887": function (event) {
indDelete()
    },
    "h0888": function (event) {
indSave()
    },
    "h0889": function (event) {
trainingPersonSelect('indf')
    },
    "h0890": function (event) {
document.getElementById('indf-status').value='completed'
    },
    "h0891": function (event) {
document.getElementById('indf-status').value='in_progress'
    },
    "h0892": function (event) {
document.getElementById('indf-status').value='failed'
    },
    "h0893": function (event) {
document.getElementById('indf-status').value='cancelled'
    },
    "h0894": function (event) {
authBack()
    },
    "h0895": function (event) {
authDelete()
    },
    "h0896": function (event) {
authSave()
    },
    "h0897": function (event) {
authPersonSelect()
    },
    "h0898": function (event) {
appAttachFileToField(this,'authr-cert-url')
    },
    "h0899": function (event) {
appPreviewFieldDocument('authr-cert-url',null,document.getElementById('authr-ref')?.value||'Licence certificate')
    },
    "h0900": function (event) {
elcBack()
    },
    "h0901": function (event) {
elcDelete()
    },
    "h0902": function (event) {
elcSave()
    },
    "h0903": function (event) {
elcUploadCourseMedia(this)
    },
    "h0904": function (event) {
elcPreviewCourseMedia()
    },
    "h0905": function (event) {
elcToggleAllPeople(true)
    },
    "h0906": function (event) {
elcToggleAllPeople(false)
    },
    "h0907": function (event) {
eleBack()
    },
    "h0908": function (event) {
eleDelete()
    },
    "h0909": function (event) {
eleSave()
    },
    "h0910": function (event) {
trainingPersonSelect('elef')
    },
    "h0911": function (event) {
eleCourseChange()
    },
    "h0912": function (event) {
eleStatusChange()
    },
    "h0913": function (event) {
eleLaunchCurrent()
    },
    "h0914": function (event) {
eleCompleteAndIssue()
    },
    "h0915": function (event) {
mocPrintRegister()
    },
    "h0916": function (event) {
mocOpenMap()
    },
    "h0917": function (event) {
mocNew()
    },
    "h0918": function (event) {
mocRender()
    },
    "h0919": function (event) {
mocRender()
    },
    "h0920": function (event) {
mocShowForm(false)
    },
    "h0921": function (event) {
mocCreateCorrectiveAction()
    },
    "h0922": function (event) {
mocAIImpactReview()
    },
    "h0923": function (event) {
mocDelete()
    },
    "h0924": function (event) {
mocSave()
    },
    "h0925": function (event) {
mapPrintRegister()
    },
    "h0926": function (event) {
mapNew()
    },
    "h0927": function (event) {
mapSetView('all',this)
    },
    "h0928": function (event) {
mapSetView('mine',this)
    },
    "h0929": function (event) {
mapSetView('overdue',this)
    },
    "h0930": function (event) {
mapSetView('verify',this)
    },
    "h0931": function (event) {
mapSetView('closure',this)
    },
    "h0932": function (event) {
mapRenderList()
    },
    "h0933": function (event) {
mapRenderList()
    },
    "h0934": function (event) {
mapShowList()
    },
    "h0935": function (event) {
mapDelete()
    },
    "h0936": function (event) {
mapAIReviewAction()
    },
    "h0937": function (event) {
mapSave('draft')
    },
    "h0938": function (event) {
mapFormTab('details',this)
    },
    "h0939": function (event) {
mapFormTab('assignment',this)
    },
    "h0940": function (event) {
mapFormTab('progress',this)
    },
    "h0941": function (event) {
mapFormTab('verification',this)
    },
    "h0942": function (event) {
mapFormTab('closure',this)
    },
    "h0943": function (event) {
mapFormTab('log',this)
    },
    "h0944": function (event) {
mapUpdateSourceLabel()
    },
    "h0945": function (event) {
mapAssignedToSelect()
    },
    "h0946": function (event) {
mapTriggerEscalation()
    },
    "h0947": function (event) {
mapUpdateProgress(this.value)
    },
    "h0948": function (event) {
mapSetEffectiveness(1)
    },
    "h0949": function (event) {
mapSetEffectiveness(2)
    },
    "h0950": function (event) {
mapSetEffectiveness(3)
    },
    "h0951": function (event) {
mapSetEffectiveness(4)
    },
    "h0952": function (event) {
mapSetEffectiveness(5)
    },
    "h0953": function (event) {
mapApproveVerification()
    },
    "h0954": function (event) {
mapFailVerification()
    },
    "h0955": function (event) {
mapApproveClosure()
    },
    "h0956": function (event) {
mapRejectClosure()
    },
    "h0957": function (event) {
sopPrintRegister()
    },
    "h0958": function (event) {
sopNew()
    },
    "h0959": function (event) {
sopSwitchTab('list',this)
    },
    "h0960": function (event) {
sopCancel()
    },
    "h0961": function (event) {
sopGoStep(1)
    },
    "h0962": function (event) {
sopGoStep(2)
    },
    "h0963": function (event) {
sopGoStep(3)
    },
    "h0964": function (event) {
sopGoStep(4)
    },
    "h0965": function (event) {
sopGoStep(5)
    },
    "h0966": function (event) {
sopNextStep(1)
    },
    "h0967": function (event) {
document.getElementById('sop-video-input').click()
    },
    "h0968": function (event) {
event.preventDefault();this.style.borderColor='var(--green)'
    },
    "h0969": function (event) {
sopHandleDrop(event)
    },
    "h0970": function (event) {
sopLoadVideo(this.files[0])
    },
    "h0971": function (event) {
sopExtractFrames()
    },
    "h0972": function (event) {
sopAddManualStep()
    },
    "h0973": function (event) {
sopNextStep(3)
    },
    "h0974": function (event) {
sopPrint()
    },
    "h0975": function (event) {
sopSaveDocument()
    },
    "h0976": function (event) {
swmsPrintRegister()
    },
    "h0977": function (event) {
swmsNew()
    },
    "h0978": function (event) {
swmsRenderList()
    },
    "h0979": function (event) {
swmsLoadList()
    },
    "h0980": function (event) {
swmsShowList()
    },
    "h0981": function (event) {
swmsPrint()
    },
    "h0982": function (event) {
swmsSaveToDocuments()
    },
    "h0983": function (event) {
swmsBuildPreview()
    },
    "h0984": function (event) {
swmsBuildPreview()
    },
    "h0985": function (event) {
openVerifiedReferenceSelect('swms-ra-ref','ra')
    },
    "h0986": function (event) {
openVerifiedReferenceSelect('swms-ptw-ref','ptw')
    },
    "h0987": function (event) {
swmsAddStep();swmsBuildPreview()
    },
    "h0988": function (event) {
swmsAIDraft()
    },
    "h0989": function (event) {
docPrintCurrentView()
    },
    "h0990": function (event) {
dcNew()
    },
    "h0991": function (event) {
dcSwitchTab('all',this)
    },
    "h0992": function (event) {
dcSwitchTab('approval',this)
    },
    "h0993": function (event) {
dcSwitchTab('expiry',this)
    },
    "h0994": function (event) {
dcSwitchTab('copies',this)
    },
    "h0995": function (event) {
dcSwitchTab('ack',this)
    },
    "h0996": function (event) {
dcFilterList()
    },
    "h0997": function (event) {
dcFilterList()
    },
    "h0998": function (event) {
dcExpiryFilter('expired',this)
    },
    "h0999": function (event) {
dcExpiryFilter('30',this)
    },
    "h1000": function (event) {
dcExpiryFilter('90',this)
    },
    "h1001": function (event) {
dcExpiryFilter('all',this)
    },
    "h1002": function (event) {
dcCopyNew()
    },
    "h1003": function (event) {
dcAckNew()
    },
    "h1004": function (event) {
dcShowList()
    },
    "h1005": function (event) {
dcDelete()
    },
    "h1006": function (event) {
dcAIReviewDocument()
    },
    "h1007": function (event) {
dcSave()
    },
    "h1008": function (event) {
dcSubmitForApproval()
    },
    "h1009": function (event) {
dcFormTab('details',this)
    },
    "h1010": function (event) {
dcFormTab('approval',this)
    },
    "h1011": function (event) {
dcFormTab('versions',this)
    },
    "h1012": function (event) {
dcFormTab('copies',this)
    },
    "h1013": function (event) {
dcFormTab('ack',this)
    },
    "h1014": function (event) {
document.getElementById('df-file-input').click()
    },
    "h1015": function (event) {
event.preventDefault();this.classList.add('dragover')
    },
    "h1016": function (event) {
this.classList.remove('dragover')
    },
    "h1017": function (event) {
dcUploadDrop(event)
    },
    "h1018": function (event) {
event.stopPropagation();dcPreviewCurrent()
    },
    "h1019": function (event) {
event.stopPropagation();dcUploadClear()
    },
    "h1020": function (event) {
dcUploadFile(this.files[0])
    },
    "h1021": function (event) {
dcUrlEntered()
    },
    "h1022": function (event) {
dcAddDistPerson()
    },
    "h1023": function (event) {
dcApprove()
    },
    "h1024": function (event) {
dcReject()
    },
    "h1025": function (event) {
dcCreateNewRevision()
    },
    "h1026": function (event) {
dcWithdraw()
    },
    "h1027": function (event) {
dcIssueCopy()
    },
    "h1028": function (event) {
dcIssueAck()
    },
    "h1029": function (event) {
dcPersonSelect('daf-emp-name','daf-dept')
    },
    "h1030": function (event) {
dcSaveAck()
    },
    "h1031": function (event) {
document.getElementById('dc-ack-form').style.display='none'
    },
    "h1032": function (event) {
dcCopyBack()
    },
    "h1033": function (event) {
dcCopySave()
    },
    "h1034": function (event) {
dcCopySelectDoc()
    },
    "h1035": function (event) {
dcPersonSelect('dcf-holder','dcf-dept')
    },
    "h1036": function (event) {
dcAckBack()
    },
    "h1037": function (event) {
dcAckSave()
    },
    "h1038": function (event) {
dcPersonSelect('saf-emp-name','saf-dept')
    },
    "h1039": function (event) {
if(event.target===this)dcCloseViewer()
    },
    "h1040": function (event) {
dcCloseViewer()
    },
    "h1041": function (event) {
peoplePrintRegister()
    },
    "h1042": function (event) {
toggleContractor()
    },
    "h1043": function (event) {
savePerson()
    },
    "h1044": function (event) {
peopleCancel()
    },
    "h1045": function (event) {
loadPeople()
    },
    "h1046": function (event) {
usersPrintRegister()
    },
    "h1047": function (event) {
usersShowInvite()
    },
    "h1048": function (event) {
openOnboarding()
    },
    "h1049": function (event) {
uSwitchTab('users',this)
    },
    "h1050": function (event) {
uSwitchTab('roles',this)
    },
    "h1051": function (event) {
uSwitchTab('invite',this)
    },
    "h1052": function (event) {
usersFilter()
    },
    "h1053": function (event) {
usersFilter()
    },
    "h1054": function (event) {
updateRole()
    },
    "h1055": function (event) {
cuSetMode('invite')
    },
    "h1056": function (event) {
cuSetMode('direct')
    },
    "h1057": function (event) {
cuGenPassword()
    },
    "h1058": function (event) {
cuSubmit()
    },
    "h1059": function (event) {
pwChangeClose()
    },
    "h1060": function (event) {
pwChangeSubmit()
    },
    "h1061": function (event) {
if(event.target===this)usersCloseProfile()
    },
    "h1062": function (event) {
usersCloseProfile()
    },
    "h1063": function (event) {
usersCloseModal()
    },
    "h1064": function (event) {
usersTempPassword(document.getElementById('uem3id').value)
    },
    "h1065": function (event) {
usersSaveEdit()
    },
    "h1066": function (event) {
adminNewCompany()
    },
    "h1067": function (event) {
adminNewSite(null)
    },
    "h1068": function (event) {
adminTab('overview',this)
    },
    "h1069": function (event) {
adminTab('companies',this)
    },
    "h1070": function (event) {
adminTab('sites',this)
    },
    "h1071": function (event) {
adminTab('hierarchy',this)
    },
    "h1072": function (event) {
adminTab('oversight',this)
    },
    "h1073": function (event) {
adminTab('access',this)
    },
    "h1074": function (event) {
adminTab('modules',this)
    },
    "h1075": function (event) {
adminFilterCompanies()
    },
    "h1076": function (event) {
adminSwitchSite(this.value)
    },
    "h1077": function (event) {
adminPrintCompanies()
    },
    "h1078": function (event) {
adminLoadSites()
    },
    "h1079": function (event) {
adminRenderHierarchy()
    },
    "h1080": function (event) {
adminGroupAI('group_summary')
    },
    "h1081": function (event) {
adminGroupAI('risk_comparison')
    },
    "h1082": function (event) {
adminGroupAI('consultant_report')
    },
    "h1083": function (event) {
adminGrantAccess()
    },
    "h1084": function (event) {
adminCloseCoModal()
    },
    "h1085": function (event) {
adminCoLogoUpload(this)
    },
    "h1086": function (event) {
adminDeleteCompany()
    },
    "h1087": function (event) {
adminSaveCompany()
    },
    "h1088": function (event) {
adminCloseSiteModal()
    },
    "h1089": function (event) {
adminSiteGetGPS()
    },
    "h1090": function (event) {
adminDeleteSite()
    },
    "h1091": function (event) {
adminSaveSite()
    },
    "h1092": function (event) {
closeModuleAccess()
    },
    "h1093": function (event) {
moduleAccessSelectPreset('starter')
    },
    "h1094": function (event) {
moduleAccessSelectPreset('production')
    },
    "h1095": function (event) {
moduleAccessSelectPreset('rollout')
    },
    "h1096": function (event) {
moduleAccessSelectPreset('none')
    },
    "h1097": function (event) {
moduleAccessSelectPreset('all')
    },
    "h1098": function (event) {
saveModuleAccess()
    },
    "h1099": function (event) {
adminCloseAccessModal()
    },
    "h1100": function (event) {
adminSaveAccess()
    },
    "h1101": function (event) {
integRefresh()
    },
    "h1102": function (event) {
integShowCustom()
    },
    "h1103": function (event) {
integTab('all',this)
    },
    "h1104": function (event) {
integTab('erp',this)
    },
    "h1105": function (event) {
integTab('hr',this)
    },
    "h1106": function (event) {
integTab('iot',this)
    },
    "h1107": function (event) {
integTab('security',this)
    },
    "h1108": function (event) {
integTab('bi',this)
    },
    "h1109": function (event) {
integTab('productivity',this)
    },
    "h1110": function (event) {
integTab('api',this)
    },
    "h1111": function (event) {
integCloseModal()
    },
    "h1112": function (event) {
integTest()
    },
    "h1113": function (event) {
integSave()
    },
    "h1114": function (event) {
integDisconnect()
    },
    "h1115": function (event) {
integCopyBaseUrl()
    },
    "h1116": function (event) {
genFullAI()
    },
    "h1117": function (event) {
aiScrollToChat()
    },
    "h1118": function (event) {
aiTab('insights',this)
    },
    "h1119": function (event) {
aiTab('safetyos',this)
    },
    "h1120": function (event) {
aiTab('qr',this); qrLoadRecords()
    },
    "h1121": function (event) {
aiTab('rams',this)
    },
    "h1122": function (event) {
aiTab('toolbox',this)
    },
    "h1123": function (event) {
aiTab('compliance',this)
    },
    "h1124": function (event) {
aiTab('risk',this)
    },
    "h1125": function (event) {
aiTab('docs',this)
    },
    "h1126": function (event) {
aiTab('chat',this)
    },
    "h1127": function (event) {
aiTab('risk',document.getElementById('aitab-risk'))
    },
    "h1128": function (event) {
aiTab('compliance',document.getElementById('aitab-compliance'))
    },
    "h1129": function (event) {
aiTab('chat',document.getElementById('aitab-chat'))
    },
    "h1130": function (event) {
safetyOSRunCheck()
    },
    "h1131": function (event) {
safetyOSExample('Welding on pipework','Tank farm','Hot work crew','hot_work')
    },
    "h1132": function (event) {
safetyOSExample('Entry for tank cleaning','Tank 4','Confined space team','confined_space')
    },
    "h1133": function (event) {
safetyOSExample('Roof maintenance and gutter cleaning','Main building roof','Maintenance team','working_at_height')
    },
    "h1134": function (event) {
safetyOSExample('Chemical transfer from drum to process tank','Chemical store','Production operator','chemical')
    },
    "h1135": function (event) {
safetyOSExample('Forklift unloading operation','Warehouse receiving bay','Warehouse team','vehicle')
    },
    "h1136": function (event) {
aiCopyOutput('safetyos-output')
    },
    "h1137": function (event) {
qrLoadRecords()
    },
    "h1138": function (event) {
qrPreviewSelected()
    },
    "h1139": function (event) {
qrRenderPreview()
    },
    "h1140": function (event) {
qrRenderPreview()
    },
    "h1141": function (event) {
qrPrintLabel()
    },
    "h1142": function (event) {
qrCopyLink()
    },
    "h1143": function (event) {
aiGenerateRAMS()
    },
    "h1144": function (event) {
aiCopyOutput('rams-output')
    },
    "h1145": function (event) {
aiDownload('rams-output','RAMS')
    },
    "h1146": function (event) {
aiGenerateToolboxTalk()
    },
    "h1147": function (event) {
aiQuickTBT('Manual handling and ergonomics')
    },
    "h1148": function (event) {
aiQuickTBT('PPE selection and correct use')
    },
    "h1149": function (event) {
aiQuickTBT('Near miss reporting - why it matters')
    },
    "h1150": function (event) {
aiQuickTBT('Working at height safety')
    },
    "h1151": function (event) {
aiQuickTBT('Chemical safety and COSHH')
    },
    "h1152": function (event) {
aiQuickTBT('Fire safety and emergency evacuation')
    },
    "h1153": function (event) {
aiQuickTBT('Electrical safety awareness')
    },
    "h1154": function (event) {
aiQuickTBT('Slips, trips and falls prevention')
    },
    "h1155": function (event) {
aiQuickTBT('Forklift and pedestrian safety')
    },
    "h1156": function (event) {
aiQuickTBT('Heat stress and hydration in hot environments')
    },
    "h1157": function (event) {
aiQuickTBT('Confined space entry procedures')
    },
    "h1158": function (event) {
aiQuickTBT('Mental health and wellbeing at work')
    },
    "h1159": function (event) {
aiCopyOutput('tbt-output')
    },
    "h1160": function (event) {
aiDownload('tbt-output','ToolboxTalk')
    },
    "h1161": function (event) {
aiComplianceCheck()
    },
    "h1162": function (event) {
aiLiveCompliance('legal')
    },
    "h1163": function (event) {
aiLiveCompliance('training')
    },
    "h1164": function (event) {
aiLiveCompliance('inspection')
    },
    "h1165": function (event) {
aiLiveCompliance('actions')
    },
    "h1166": function (event) {
aiCopyOutput('comp-output')
    },
    "h1167": function (event) {
aiDownload('comp-output','ComplianceCheck')
    },
    "h1168": function (event) {
aiPredictiveRisk()
    },
    "h1169": function (event) {
aiScenarioRisk()
    },
    "h1170": function (event) {
aiRiskHeatmap()
    },
    "h1171": function (event) {
aiAnalyseDocument()
    },
    "h1172": function (event) {
aiCreateDocActions()
    },
    "h1173": function (event) {
aiCopyOutput('doc-output')
    },
    "h1174": function (event) {
aiDownload('doc-output','DocumentAnalysis')
    },
    "h1175": function (event) {
aiChatPrompt('What are our top 3 safety risks right now?')
    },
    "h1176": function (event) {
aiChatPrompt('What corrective actions are most overdue?')
    },
    "h1177": function (event) {
aiChatPrompt('Which departments have the most incidents?')
    },
    "h1178": function (event) {
aiChatPrompt('Summarise our HSE performance this month')
    },
    "h1179": function (event) {
aiChatPrompt('What training is expiring in the next 60 days?')
    },
    "h1180": function (event) {
aiChatPrompt('Generate a daily safety briefing for today')
    },
    "h1181": function (event) {
if(event.key==='Enter')aiChatSend()
    },
    "h1182": function (event) {
aiChatSend()
    },
    "h1183": function (event) {
loadApprovals()
    },
    "h1184": function (event) {
showPage('settings',document.getElementById('nav-settings'))
    },
    "h1185": function (event) {
approvalsRender()
    },
    "h1186": function (event) {
approvalsRender()
    },
    "h1187": function (event) {
document.getElementById('approvals-search').value='';document.getElementById('approvals-filter-status').value='';document.getElementById('approvals-filter-module').value='';approvalsRender()
    },
    "h1188": function (event) {
loadAudit()
    },
    "h1189": function (event) {
auditExportCsv()
    },
    "h1190": function (event) {
auditRender()
    },
    "h1191": function (event) {
auditRender()
    },
    "h1192": function (event) {
document.getElementById('auditlog-search').value='';document.getElementById('audit-filter-action').value='';document.getElementById('audit-filter-module').value='';auditRender()
    },
    "h1193": function (event) {
brandResetDefaults()
    },
    "h1194": function (event) {
brandSave()
    },
    "h1195": function (event) {
brandLivePreview()
    },
    "h1196": function (event) {
brandSyncHex('primary')
    },
    "h1197": function (event) {
brandSyncHex('secondary')
    },
    "h1198": function (event) {
brandSyncHex('accent')
    },
    "h1199": function (event) {
document.getElementById('br-logo-file').click()
    },
    "h1200": function (event) {
brandLogoDrop(event,'light')
    },
    "h1201": function (event) {
brandLogoFile(this,'light')
    },
    "h1202": function (event) {
brandLogoUrl('light')
    },
    "h1203": function (event) {
brandLogoClear('light')
    },
    "h1204": function (event) {
document.getElementById('br-logo-dark-file').click()
    },
    "h1205": function (event) {
brandLogoDrop(event,'dark')
    },
    "h1206": function (event) {
brandLogoFile(this,'dark')
    },
    "h1207": function (event) {
brandLogoUrl('dark')
    },
    "h1208": function (event) {
brandLogoClear('dark')
    },
    "h1209": function (event) {
loadRolloutControl()
    },
    "h1210": function (event) {
loadSystemHealth()
    },
    "h1211": function (event) {
loadRelationshipRepairQueue(true)
    },
    "h1212": function (event) {
loadPersonIdentityReconciliation(true)
    },
    "h1213": function (event) {
dashOpenMeetingChecklist()
    },
    "h1214": function (event) {
dashOpenDemoReview()
    },
    "h1215": function (event) {
copyClientDemoSummary()
    },
    "h1216": function (event) {
document.getElementById('ai-window').classList.remove('open')
    },
    "h1217": function (event) {
if(event.key==='Enter')sendAIMsg()
    },
    "h1218": function (event) {
sendAIMsg()
    },
    "h1219": function (event) {
document.getElementById('ai-window').classList.toggle('open')
    },
    "h1220": function (event) {
closeOnboarding()
    },
    "h1221": function (event) {
obAddSite()
    },
    "h1222": function (event) {
obBack()
    },
    "h1223": function (event) {
obNext()
    },
    "h1224": function (event) {
loadSiteMap()
    },
    "h1225": function (event) {
smPrintMap()
    },
    "h1226": function (event) {
showPage('admin',document.getElementById('nav-admin'))
    },
    "h1227": function (event) {
smRenderSiteList()
    },
    "h1228": function (event) {
smNewPlan()
    },
    "h1229": function (event) {
smUploadPlan(this)
    },
    "h1230": function (event) {
smSaveLayout()
    },
    "h1231": function (event) {
smPositionSelectedSite()
    },
    "h1232": function (event) {
smToggleMapEvents()
    },
    "h1233": function (event) {
smToggleMapRisks()
    },
    "h1234": function (event) {
fireShowCertForm(null)
    },
    "h1235": function (event) {
firePrintReport()
    },
    "h1236": function (event) {
fireSwitchTab('certs',this)
    },
    "h1237": function (event) {
fireSwitchTab('inspections',this)
    },
    "h1238": function (event) {
fireSwitchTab('equipment',this)
    },
    "h1239": function (event) {
fireSwitchTab('layout',this)
    },
    "h1240": function (event) {
fireSwitchTab('dashboard',this)
    },
    "h1241": function (event) {
fireFilterCerts(this.value)
    },
    "h1242": function (event) {
fireShowInspForm(null)
    },
    "h1243": function (event) {
fireShowEquipForm(null)
    },
    "h1244": function (event) {
fireNewLayoutPlan()
    },
    "h1245": function (event) {
fireBackToLayoutList()
    },
    "h1246": function (event) {
fireSaveLayoutPlan()
    },
    "h1247": function (event) {
firePrintLayoutPlan()
    },
    "h1248": function (event) {
fireUploadLayout(this)
    },
    "h1249": function (event) {
fireClearLayout()
    },
    "h1250": function (event) {
fireSelectLayoutPlan(this.value)
    },
    "h1251": function (event) {
fireAddCustomSymbol()
    },
    "h1252": function (event) {
fireAddLayoutMarker(event)
    },
    "h1253": function (event) {
document.getElementById('fire-cert-modal').style.display='none'
    },
    "h1254": function (event) {
appAttachFileToField(this,'fc-doc-url')
    },
    "h1255": function (event) {
appPreviewFieldDocument('fc-doc-url',null,document.getElementById('fc-number')?.value||'Fire certificate')
    },
    "h1256": function (event) {
fireSaveCert()
    },
    "h1257": function (event) {
document.getElementById('fire-insp-modal').style.display='none'
    },
    "h1258": function (event) {
fireAddFindingRow()
    },
    "h1259": function (event) {
fireSaveInsp()
    },
    "h1260": function (event) {
document.getElementById('fire-equip-modal').style.display='none'
    },
    "h1261": function (event) {
fireSaveEquip()
    }
  };
  var eventTypes = ["change","click","dragleave","dragover","drop","input","keydown","mouseout","mouseover"];

  function dispatch(eventType, event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var attribute = 'data-auris-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(attribute);
      if (handlerId && handlers[handlerId]) {
        var result = handlers[handlerId].call(node, event);
        if (result === false) event.preventDefault();
      }
      if (event.cancelBubble) break;
      node = node.parentElement;
    }
  }

  eventTypes.forEach(function (eventType) {
    document.addEventListener(eventType, function (event) {
      dispatch(eventType, event);
    });
  });
})();
