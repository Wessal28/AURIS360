(function () {
  'use strict';
  var handlers = {
    "g0001": function (event) {
obsNew()
    },
    "g0002": function (event) {
obsEdit(this.dataset.id)
    },
    "g0003": function (event) {
document.getElementById('dc-ai-review-panel').style.display='none'
    },
    "g0004": function (event) {
dcAIApplyDetails()
    },
    "g0005": function (event) {
dcAIApplyReviewDates()
    },
    "g0006": function (event) {
dcAIApplyReviewComments()
    },
    "g0007": function (event) {
dashCloseControlCentreModal()
    },
    "g0008": function (event) {
loadDash()
    },
    "g0009": function (event) {
showPage('executive',document.getElementById('nav-executive'))
    },
    "g0010": function (event) {
printMonthlySummary()
    },
    "g0011": function (event) {
loadDash()
    },
    "g0012": function (event) {
dashOpenWidgetDetail('riskmap')
    },
    "g0013": function (event) {
dashOpenWidgetDetail('actions')
    },
    "g0014": function (event) {
dashNavClick(event,'actions')
    },
    "g0015": function (event) {
dashOpenWidgetDetail('trend')
    },
    "g0016": function (event) {
dashNavClick(event,'events')
    },
    "g0017": function (event) {
dashOpenWidgetDetail('tasks')
    },
    "g0018": function (event) {
dashOpenWidgetDetail('upcoming')
    },
    "g0019": function (event) {
dashNavClick(event,'workschedule')
    },
    "g0020": function (event) {
dashOpenWidgetDetail('compliance')
    },
    "g0021": function (event) {
dashNavClick(event,'legal')
    },
    "g0022": function (event) {
dashCloseMeetingChecklist()
    },
    "g0023": function (event) {
window.print()
    },
    "g0024": function (event) {
copyClientDemoObjections()
    },
    "g0025": function (event) {
copyClientRolloutOnboarding()
    },
    "g0026": function (event) {
copyClientAcceptanceSignoff()
    },
    "g0027": function (event) {
saveClientAcceptanceSignoff()
    },
    "g0028": function (event) {
copyClientReadinessIssues()
    },
    "g0029": function (event) {
clientRolloutAddIssue()
    },
    "g0030": function (event) {
copyClientProposalSnapshot()
    },
    "g0031": function (event) {
copyClientEnterpriseReadiness()
    },
    "g0032": function (event) {
copyClientDecisionLog()
    },
    "g0033": function (event) {
clientDecisionAdd()
    },
    "g0034": function (event) {
copyClientValueSnapshot()
    },
    "g0035": function (event) {
clientDemoLoadDataChecklist()
    },
    "g0036": function (event) {
dashCloseDemoReview()
    },
    "g0037": function (event) {
copyClientDemoReview()
    },
    "g0038": function (event) {
this.style.opacity=0.8
    },
    "g0039": function (event) {
this.style.opacity=1
    },
    "g0040": function (event) {
execCopyAIReport()
    },
    "g0041": function (event) {
execDownloadAIReport()
    },
    "g0042": function (event) {
execPrintAIReport()
    },
    "g0043": function (event) {
aiCopyOutput(this)
    },
    "g0044": function (event) {
evSwitchToEdit()
    },
    "g0045": function (event) {
deleteNoiseSurvey(this.getAttribute('data-id'))
    },
    "g0046": function (event) {
noiseRenderPlanPreview();noiseAssessHpe()
    },
    "g0047": function (event) {
noiseAssessHpe()
    },
    "g0048": function (event) {
noiseRenderPlanPreview()
    },
    "g0049": function (event) {
chemNew()
    },
    "g0050": function (event) {
chemClearAIReview()
    },
    "g0051": function (event) {
chemAIApplyReview()
    },
    "g0052": function (event) {
sopNew()
    },
    "g0053": function (event) {
sopView(this.getAttribute('data-id'))
    },
    "g0054": function (event) {
sopPrintById(this.getAttribute('data-id'))
    },
    "g0055": function (event) {
sopDelete(this.getAttribute('data-id'))
    },
    "g0056": function (event) {
swmsNew()
    },
    "g0057": function (event) {
this.closest('tr').remove();swmsRenumber();swmsBuildPreview()
    },
    "g0058": function (event) {
swmsBuildPreview()
    },
    "g0059": function (event) {
mtgNewSeries()
    },
    "g0060": function (event) {
mtgScheduleMeeting(this.getAttribute('data-id'))
    },
    "g0061": function (event) {
mtgEditSeries(this.getAttribute('data-id'))
    },
    "g0062": function (event) {
this.parentNode.parentNode.remove()
    },
    "g0063": function (event) {
mtgOpenMom(this.getAttribute('data-id'))
    },
    "g0064": function (event) {
mtgDeleteMomFromList(this.getAttribute('data-id'))
    },
    "g0065": function (event) {
peopleNew()
    },
    "g0066": function (event) {
loadRelationshipRepairQueue(true)
    },
    "g0067": function (event) {
loadPersonIdentityReconciliation(true)
    },
    "g0068": function (event) {
showPage('people')
    },
    "g0069": function (event) {
saveSecuritySlaSettings()
    },
    "g0070": function (event) {
copySecurityClientSummary()
    },
    "g0071": function (event) {
previewSecurityClientSummary()
    },
    "g0072": function (event) {
showPage("audit",document.getElementById("nav-audit"))
    },
    "g0073": function (event) {
showPage("approvals",document.getElementById("nav-approvals"))
    },
    "g0074": function (event) {
loadCustomFieldSettings()
    },
    "g0075": function (event) {
customNewField()
    },
    "g0076": function (event) {
customHideFieldForm()
    },
    "g0077": function (event) {
customToggleOptionsHelp()
    },
    "g0078": function (event) {
customSaveField()
    },
    "g0079": function (event) {
savePTWApprovalSettings()
    },
    "g0080": function (event) {
approvalNewWorkflow()
    },
    "g0081": function (event) {
approvalRenderWorkflows()
    },
    "g0082": function (event) {
approvalSaveWorkflow()
    },
    "g0083": function (event) {
openObjModal()
    },
    "g0084": function (event) {
wsNew()
    },
    "g0085": function (event) {
wsShowDetail(this.dataset.id)
    },
    "g0086": function (event) {
wsTEAddManual()
    },
    "g0087": function (event) {
wsTEAddFromRegister(this.dataset.id)
    },
    "g0088": function (event) {
this.style.boxShadow=''
    },
    "g0089": function (event) {
wsChkScore()
    },
    "g0090": function (event) {
imsOpenEvidenceFile(this.dataset.path)
    },
    "g0091": function (event) {
imsClearDashFilter()
    },
    "g0092": function (event) {
imsOpenEdit(this.dataset.id)
    },
    "g0093": function (event) {
imsScrollIncidentRegister()
    },
    "g0094": function (event) {
imsOpenIncidentStats()
    },
    "g0095": function (event) {
imsNewInvestigation()
    },
    "g0096": function (event) {
event.stopPropagation();imsOpenInvestigation(this.dataset.id)
    },
    "g0097": function (event) {
this.closest('.ws3-why-row').remove()
    },
    "g0098": function (event) {
this.closest('.inv-timeline-row').remove()
    },
    "g0099": function (event) {
this.closest('.inv-ca-row').remove()
    },
    "g0100": function (event) {
invAIApplyField('root_cause_summary')
    },
    "g0101": function (event) {
invAIApplyField('systemic_factors')
    },
    "g0102": function (event) {
invAIApplyField('recurrence')
    },
    "g0103": function (event) {
invAIApplyFiveWhys()
    },
    "g0104": function (event) {
invAIApplyActions('corrective_actions')
    },
    "g0105": function (event) {
invAIApplyActions('preventive_actions')
    },
    "g0106": function (event) {
document.getElementById('inv-ai-review-panel').style.display='none'
    },
    "g0107": function (event) {
invRemoveTeamMember(parseInt(this.dataset.i))
    },
    "g0108": function (event) {
invWitnessFileSel(this)
    },
    "g0109": function (event) {
invViewStatement(this)
    },
    "g0110": function (event) {
invDeleteWitnessRow(this)
    },
    "g0111": function (event) {
this.closest('div[style*=inset]').remove()
    },
    "g0112": function (event) {
imsNewEvidence()
    },
    "g0113": function (event) {
imsEditEvidence(this.dataset.id)
    },
    "g0114": function (event) {
event.stopPropagation();imsOpenEvidenceFile(this.dataset.path)
    },
    "g0115": function (event) {
raShowNewPanel()
    },
    "g0116": function (event) {
raOpen(this.dataset.id)
    },
    "g0117": function (event) {
jsaNew()
    },
    "g0118": function (event) {
jsaEdit(this.dataset.id)
    },
    "g0119": function (event) {
raNew('hira')
    },
    "g0120": function (event) {
raApproveCurrent()
    },
    "g0121": function (event) {
raRejectCurrent()
    },
    "g0122": function (event) {
raReleaseForEdit()
    },
    "g0123": function (event) {
raCalcRL(this)
    },
    "g0124": function (event) {
raGetControlSuggestions(this)
    },
    "g0125": function (event) {
this.closest('tr').remove();raUpdateQualityPanel()
    },
    "g0126": function (event) {
raPreviewRamsDocument()
    },
    "g0127": function (event) {
raUploadCompanyTemplate(this.files[0]);this.value=''
    },
    "g0128": function (event) {
document.getElementById('ra-company-template-file').click()
    },
    "g0129": function (event) {
this.style.borderColor='#185FA5';this.style.background='#EFF6FF'
    },
    "g0130": function (event) {
this.style.borderColor='var(--border)';this.style.background='#fff'
    },
    "g0131": function (event) {
raSpecificUpdatePreview()
    },
    "g0132": function (event) {
this.closest('[style*=fixed]').remove()
    },
    "g0133": function (event) {
this.closest('.jsa-step-card').remove()
    },
    "g0134": function (event) {
ptwNew()
    },
    "g0135": function (event) {
ptwShowDetail(this.dataset.id)
    },
    "g0136": function (event) {
ptwOpenGasPanel()
    },
    "g0137": function (event) {
ptwOpenIsolationPanel()
    },
    "g0138": function (event) {
conOpenDetail(this.getAttribute('data-id'))
    },
    "g0139": function (event) {
conNew()
    },
    "g0140": function (event) {
this.style.background='#fafafa'
    },
    "g0141": function (event) {
this.style.background=''
    },
    "g0142": function (event) {
event.stopPropagation();conEdit(this.getAttribute('data-id'))
    },
    "g0143": function (event) {
event.stopPropagation();conDeleteFromList(this.getAttribute('data-id'))
    },
    "g0144": function (event) {
cpaCalcScore()
    },
    "g0145": function (event) {
cpaNew()
    },
    "g0146": function (event) {
cpaEdit(this.getAttribute('data-id'))
    },
    "g0147": function (event) {
cpaDeleteRow(this.getAttribute('data-id'))
    },
    "g0148": function (event) {
cevNew()
    },
    "g0149": function (event) {
cevEdit(this.getAttribute('data-id'))
    },
    "g0150": function (event) {
cevDeleteRow(this.getAttribute('data-id'))
    },
    "g0151": function (event) {
catwNew()
    },
    "g0152": function (event) {
catwEdit(this.getAttribute('data-id'))
    },
    "g0153": function (event) {
catwDeleteRow(this.getAttribute('data-id'))
    },
    "g0154": function (event) {
cirNew()
    },
    "g0155": function (event) {
cirEdit(this.getAttribute('data-id'))
    },
    "g0156": function (event) {
cirDeleteRow(this.getAttribute('data-id'))
    },
    "g0157": function (event) {
esgWasteNew()
    },
    "g0158": function (event) {
esgWasteEdit(this.getAttribute('data-id'))
    },
    "g0159": function (event) {
esgWasteDel(this.getAttribute('data-id'))
    },
    "g0160": function (event) {
esgHWNew()
    },
    "g0161": function (event) {
esgHWEdit(this.getAttribute('data-id'))
    },
    "g0162": function (event) {
esgHWDel(this.getAttribute('data-id'))
    },
    "g0163": function (event) {
esgFuelNew()
    },
    "g0164": function (event) {
esgFuelEdit(this.getAttribute('data-id'))
    },
    "g0165": function (event) {
esgFuelDel(this.getAttribute('data-id'))
    },
    "g0166": function (event) {
esgWaterNew()
    },
    "g0167": function (event) {
esgWaterEdit(this.getAttribute('data-id'))
    },
    "g0168": function (event) {
esgWaterDel(this.getAttribute('data-id'))
    },
    "g0169": function (event) {
esgSpillNew()
    },
    "g0170": function (event) {
esgSpillEdit(this.getAttribute('data-id'))
    },
    "g0171": function (event) {
esgSpillDel(this.getAttribute('data-id'))
    },
    "g0172": function (event) {
esgInspNew()
    },
    "g0173": function (event) {
esgInspEdit(this.getAttribute('data-id'))
    },
    "g0174": function (event) {
esgInspDel(this.getAttribute('data-id'))
    },
    "g0175": function (event) {
emSwitchTab('plans',document.getElementById('em3tab-plans'))
    },
    "g0176": function (event) {
emPlanNew()
    },
    "g0177": function (event) {
emPlanEdit(this.dataset.id)
    },
    "g0178": function (event) {
ertNew()
    },
    "g0179": function (event) {
event.stopPropagation()
    },
    "g0180": function (event) {
ertEdit(this.dataset.id)
    },
    "g0181": function (event) {
musterNew()
    },
    "g0182": function (event) {
musterEdit(this.dataset.id)
    },
    "g0183": function (event) {
drillNew()
    },
    "g0184": function (event) {
drillEdit(this.getAttribute('data-id'))
    },
    "g0185": function (event) {
drillDelete(this.getAttribute('data-id'))
    },
    "g0186": function (event) {
activationNew()
    },
    "g0187": function (event) {
activationEdit(this.dataset.id)
    },
    "g0188": function (event) {
bcpNew()
    },
    "g0189": function (event) {
bcpEdit(this.dataset.id)
    },
    "g0190": function (event) {
emEqNew()
    },
    "g0191": function (event) {
emEqEdit(this.getAttribute('data-id'))
    },
    "g0192": function (event) {
emEqDeleteRow(this.getAttribute('data-id'))
    },
    "g0193": function (event) {
msNew()
    },
    "g0194": function (event) {
msEdit(this.dataset.id)
    },
    "g0195": function (event) {
msDeleteRow(this.dataset.id)
    },
    "g0196": function (event) {
audNew()
    },
    "g0197": function (event) {
audEdit(this.dataset.id)
    },
    "g0198": function (event) {
audDeleteRow(this.dataset.id)
    },
    "g0199": function (event) {
spiNew()
    },
    "g0200": function (event) {
spiEdit(this.dataset.id)
    },
    "g0201": function (event) {
spiDeleteRow(this.dataset.id)
    },
    "g0202": function (event) {
vaxNew()
    },
    "g0203": function (event) {
vaxEdit(this.dataset.id)
    },
    "g0204": function (event) {
vaxDeleteRow(this.dataset.id)
    },
    "g0205": function (event) {
expNew()
    },
    "g0206": function (event) {
expEdit(this.dataset.id)
    },
    "g0207": function (event) {
expDeleteRow(this.dataset.id)
    },
    "g0208": function (event) {
expCalcRisk()
    },
    "g0209": function (event) {
odNew()
    },
    "g0210": function (event) {
odEdit(this.dataset.id)
    },
    "g0211": function (event) {
odDeleteRow(this.dataset.id)
    },
    "g0212": function (event) {
ppePrintCurrentView()
    },
    "g0213": function (event) {
ppeCatNew()
    },
    "g0214": function (event) {
ppeCatEdit(this.dataset.id)
    },
    "g0215": function (event) {
ppeIssNew()
    },
    "g0216": function (event) {
ppeIssEdit(this.dataset.id)
    },
    "g0217": function (event) {
ppeIssDeleteRow(this.dataset.id)
    },
    "g0218": function (event) {
ppeInspNew()
    },
    "g0219": function (event) {
ppeInspEdit(this.dataset.id)
    },
    "g0220": function (event) {
ppeInspDeleteRow(this.dataset.id)
    },
    "g0221": function (event) {
ppeRepNew()
    },
    "g0222": function (event) {
ppeRepEdit(this.dataset.id)
    },
    "g0223": function (event) {
ppeRepDeleteRow(this.dataset.id)
    },
    "g0224": function (event) {
toolsNew()
    },
    "g0225": function (event) {
event.stopPropagation();toolsStartInspection(this.getAttribute('data-id'))
    },
    "g0226": function (event) {
event.stopPropagation();toolsEdit(this.getAttribute('data-id'))
    },
    "g0227": function (event) {
event.stopPropagation();toolsDeleteFromList(this.getAttribute('data-id'))
    },
    "g0228": function (event) {
toolsNewInspection()
    },
    "g0229": function (event) {
toolsViewInspection(this.getAttribute('data-id'))
    },
    "g0230": function (event) {
toolsNewLiftingAccessory()
    },
    "g0231": function (event) {
toolsStartLiftingInspection(this.getAttribute('data-id'))
    },
    "g0232": function (event) {
toolsEdit(this.getAttribute('data-id'))
    },
    "g0233": function (event) {
toolsInspScore()
    },
    "g0234": function (event) {
toolsNewRCD()
    },
    "g0235": function (event) {
event.stopPropagation();toolsStartRCDTest(this.getAttribute('data-id'))
    },
    "g0236": function (event) {
toolsNewVehicle()
    },
    "g0237": function (event) {
toolsStartInspection(this.getAttribute('data-id'))
    },
    "g0238": function (event) {
document.getElementById('tools-inspection-detail-modal')?.remove()
    },
    "g0239": function (event) {
fleetNewVehicle()
    },
    "g0240": function (event) {
document.getElementById('fleet-search').value='';document.getElementById('fleet-filter-status').value='';document.getElementById('fleet-filter-check').value='';fleetRender()
    },
    "g0241": function (event) {
event.stopPropagation();fleetMonthlyCheck(this.getAttribute('data-id'))
    },
    "g0242": function (event) {
event.stopPropagation();fleetFuelNew(this.getAttribute('data-label'))
    },
    "g0243": function (event) {
event.stopPropagation();fleetEditVehicle(this.getAttribute('data-id'))
    },
    "g0244": function (event) {
atexNew()
    },
    "g0245": function (event) {
event.stopPropagation();atexEdit(this.getAttribute('data-id'))
    },
    "g0246": function (event) {
event.stopPropagation();atexOpenLinkedRecord('ra',this.dataset.id)
    },
    "g0247": function (event) {
event.stopPropagation();atexOpenLinkedRecord('ptw',this.dataset.id)
    },
    "g0248": function (event) {
mocNew()
    },
    "g0249": function (event) {
mocEdit(this.dataset.id)
    },
    "g0250": function (event) {
document.getElementById('moc-ai-panel').style.display='none'
    },
    "g0251": function (event) {
mocAIApplyReview()
    },
    "g0252": function (event) {
mapNew()
    },
    "g0253": function (event) {
mapEdit(this.dataset.id)
    },
    "g0254": function (event) {
mapAISuggestion=null;document.getElementById('map-ai-review-panel').style.display='none'
    },
    "g0255": function (event) {
dcNew()
    },
    "g0256": function (event) {
dcEdit(this.dataset.id)
    },
    "g0257": function (event) {
return false
    },
    "g0258": function (event) {
dcIssueAck()
    },
    "g0259": function (event) {
dcMarkAckComplete(this.dataset.id)
    },
    "g0260": function (event) {
this.parentElement.remove()
    },
    "g0261": function (event) {
legalTogglePdfRows(true)
    },
    "g0262": function (event) {
legalTogglePdfRows(false)
    },
    "g0263": function (event) {
legalImportPdfRows()
    },
    "g0264": function (event) {
legalNewRequirement()
    },
    "g0265": function (event) {
legalToggleVisibleSelection(true)
    },
    "g0266": function (event) {
legalToggleVisibleSelection(false)
    },
    "g0267": function (event) {
legalDeleteSelectedReqs()
    },
    "g0268": function (event) {
legalDeleteCurrentLegislation()
    },
    "g0269": function (event) {
legalToggleVisibleSelection(this.checked)
    },
    "g0270": function (event) {
event.stopPropagation();legalOpenReq(this.dataset.id)
    },
    "g0271": function (event) {
legalAssessmentScopeChanged()
    },
    "g0272": function (event) {
legalRenderAssessmentMatrix();lcaUpdateLiveScore()
    },
    "g0273": function (event) {
lcaMarkAllNoGap()
    },
    "g0274": function (event) {
lcaUpdateLiveScore()
    },
    "g0275": function (event) {
lcaStatusChanged(this)
    },
    "g0276": function (event) {
lcaGapChanged(this)
    },
    "g0277": function (event) {
lcaUpdateLiveScore()
    },
    "g0278": function (event) {
legalNewChange()
    },
    "g0279": function (event) {
legalClearChangeFilters()
    },
    "g0280": function (event) {
legalOpenChg(this.dataset.id)
    },
    "g0281": function (event) {
legalDeleteChgFromList(this.dataset.id)
    },
    "g0282": function (event) {
lcaNew()
    },
    "g0283": function (event) {
lcaEdit(this.dataset.id)
    },
    "g0284": function (event) {
gapNew()
    },
    "g0285": function (event) {
gapEdit(this.dataset.id)
    },
    "g0286": function (event) {
calNew()
    },
    "g0287": function (event) {
calEdit(this.dataset.id)
    },
    "g0288": function (event) {
this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)'
    },
    "g0289": function (event) {
document.getElementById('legal-ai-assess-panel').style.display='none'
    },
    "g0290": function (event) {
legalAIApplyStatus()
    },
    "g0291": function (event) {
legalAIApplyEvidence()
    },
    "g0292": function (event) {
legalAIApplyGap()
    },
    "g0293": function (event) {
legalAIApplyResponsibility()
    },
    "g0294": function (event) {
tbtNew()
    },
    "g0295": function (event) {
tbtEdit(this.dataset.id)
    },
    "g0296": function (event) {
tbtSyncConfirmationTime(this)
    },
    "g0297": function (event) {
tbtFillAttendeeDept(this)
    },
    "g0298": function (event) {
tbtConfirmAttendee(this)
    },
    "g0299": function (event) {
this.closest('.tbt-att-row').remove();tbtUpdateCount()
    },
    "g0300": function (event) {
this.closest('.tbt-act-row').remove()
    },
    "g0301": function (event) {
document.getElementById('tbt-ai-draft-panel').style.display='none'
    },
    "g0302": function (event) {
tbtAIApplyContent()
    },
    "g0303": function (event) {
tbtAIApplyActions()
    },
    "g0304": function (event) {
alertNew()
    },
    "g0305": function (event) {
alertEdit(this.dataset.id)
    },
    "g0306": function (event) {
bulletinNew()
    },
    "g0307": function (event) {
bulletinEdit(this.dataset.id)
    },
    "g0308": function (event) {
bulletinCopyCheckRegister()
    },
    "g0309": function (event) {
cmAddCompetency()
    },
    "g0310": function (event) {
cmEditCell(this.dataset.pid,this.dataset.cid)
    },
    "g0311": function (event) {
tnaAddRow()
    },
    "g0312": function (event) {
tpNew()
    },
    "g0313": function (event) {
tpOpen(this.getAttribute('data-id'))
    },
    "g0314": function (event) {
tpDeleteFromList(this.getAttribute('data-id'))
    },
    "g0315": function (event) {
document.getElementById('train-ai-gap-panel').style.display='none'
    },
    "g0316": function (event) {
trainingAIApplyPlanItem(parseInt(this.getAttribute('data-i'),10))
    },
    "g0317": function (event) {
tfNew()
    },
    "g0318": function (event) {
trainingPreviewAttachment(this.getAttribute('data-url'),this.getAttribute('data-name'))
    },
    "g0319": function (event) {
tfOpen(this.getAttribute('data-id'))
    },
    "g0320": function (event) {
tfDeleteFromList(this.getAttribute('data-id'))
    },
    "g0321": function (event) {
authNew()
    },
    "g0322": function (event) {
authOpen(this.getAttribute('data-id'))
    },
    "g0323": function (event) {
authDeleteFromList(this.getAttribute('data-id'))
    },
    "g0324": function (event) {
auditStartFromCurrentTab()
    },
    "g0325": function (event) {
auditOpen(this.dataset.id)
    },
    "g0326": function (event) {
auditUploadEvidenceFile(this)
    },
    "g0327": function (event) {
auditPreviewEvidenceRow(this)
    },
    "g0328": function (event) {
this.closest('.audit-finding-row').remove()
    },
    "g0329": function (event) {
document.getElementById('audit-ai-output').style.display='none'
    },
    "g0330": function (event) {
auditAIApplyReview()
    },
    "g0331": function (event) {
this.closest('.if-action-row').remove()
    },
    "g0332": function (event) {
auditAddPhotoRow()
    },
    "g0333": function (event) {
findingClose(this.dataset.id)
    },
    "g0334": function (event) {
psNew()
    },
    "g0335": function (event) {
event.stopPropagation();psOpen(this.dataset.id)
    },
    "g0336": function (event) {
usersEdit(this.dataset.id)
    },
    "g0337": function (event) {
usersResetPw(this.dataset.id)
    },
    "g0338": function (event) {
usersTempPassword(this.dataset.id)
    },
    "g0339": function (event) {
usersToggleStatus(this.dataset.id,this.dataset.active)
    },
    "g0340": function (event) {
usersDelete(this.dataset.id)
    },
    "g0341": function (event) {
usersSaveNotificationPreferences()
    },
    "g0342": function (event) {
usersSetWhatsappConsent(false)
    },
    "g0343": function (event) {
usersSetWhatsappConsent(true)
    },
    "g0344": function (event) {
navigator.clipboard.writeText(this.dataset.creds).then(function(){toast('Copied credentials');})
    },
    "g0345": function (event) {
saCompanyPick(null)
    },
    "g0346": function (event) {
showPage('X',this)
    },
    "g0347": function (event) {
this.style.display='none'
    },
    "g0348": function (event) {
adminEditCompany(this.dataset.id)
    },
    "g0349": function (event) {
adminNewSite(null)
    },
    "g0350": function (event) {
adminEditSite(this.dataset.id)
    },
    "g0351": function (event) {
adminNewChildSite(this.dataset.co,this.dataset.parent)
    },
    "g0352": function (event) {
adminModSetDefault(this.dataset.id)
    },
    "g0353": function (event) {
adminModSetAll(this.dataset.id,true)
    },
    "g0354": function (event) {
adminModSetAll(this.dataset.id,false)
    },
    "g0355": function (event) {
adminModToggle(this)
    },
    "g0356": function (event) {
adminGrantAccess()
    },
    "g0357": function (event) {
adminRevokeAccess(this.dataset.id)
    },
    "g0358": function (event) {
this.style.boxShadow='0 4px 20px rgba(0,0,0,.12)'
    },
    "g0359": function (event) {
elcSyncPeopleSelectFromChecks()
    },
    "g0360": function (event) {
eleCloseVideoPlayer()
    },
    "g0361": function (event) {
dashOpenElearning()
    },
    "g0362": function (event) {
deepLinkResume('retry')
    },
    "g0363": function (event) {
deepLinkClear(true)
    },
    "g0364": function (event) {
offlineSyncNow()
    },
    "g0365": function (event) {
runNotificationRoutingSimulation()
    },
    "g0366": function (event) {
saveNotifSettings()
    },
    "g0367": function (event) {
sendTestEmail()
    },
    "g0368": function (event) {
loadNotifSettings()
    },
    "g0369": function (event) {
saveWhatsappChannelSettings()
    },
    "g0370": function (event) {
fireSelectLayoutPlan(this.dataset.id)
    },
    "g0371": function (event) {
event.stopPropagation();fireSelectLayoutPlan(this.dataset.id)
    },
    "g0372": function (event) {
event.stopPropagation();firePrintLayoutPlanById(this.dataset.id)
    },
    "g0373": function (event) {
event.stopPropagation();fireDeleteLayoutPlan(this.dataset.id)
    },
    "g0374": function (event) {
event.stopPropagation();fireSelectLayoutMarker(this.dataset.mid)
    },
    "g0375": function (event) {
fireSelectLayoutMarker(this.dataset.mid)
    },
    "g0376": function (event) {
fireStartMoveLayoutMarker()
    },
    "g0377": function (event) {
fireRemoveLayoutMarker()
    },
    "g0378": function (event) {
fireSwitchTab('equipment')
    },
    "g0379": function (event) {
fireSwitchTab('inspections')
    },
    "g0380": function (event) {
fireSwitchTab('layout')
    },
    "g0381": function (event) {
this.parentNode.remove()
    },
    "g0382": function (event) {
showPage('events',null)
    },
    "g0383": function (event) {
smClearMapEvent()
    },
    "g0384": function (event) {
showPage('risk',null)
    },
    "g0385": function (event) {
smClearMapRisk()
    },
    "g0386": function (event) {
smCanvasClick(event)
    }
  };
  var eventTypes = ["change","click","contextmenu","error","input","mouseout","mouseover"];

  function dispatch(eventType, event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var attribute = 'data-auris-generated-on' + eventType;
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
    }, eventType === 'error');
  });
})();
