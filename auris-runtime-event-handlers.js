(function () {
  'use strict';
  var handlers = {
    "r0001": function (event, args) {
connectedRecordsTogglePicker(args[0])
    },
    "r0002": function (event, args) {
connectedRecordsRemove(args[0],args[1])
    },
    "r0003": function (event, args) {
connectedRecordsSearch(args[0])
    },
    "r0004": function (event, args) {
connectedRecordsFilterPicker(args[0])
    },
    "r0005": function (event, args) {
connectedRecordsTogglePicker(args[0],false)
    },
    "r0006": function (event, args) {
connectedRecordsAdd(args[0])
    },
    "r0007": function (event, args) {
obsRemovePhoto(args[0])
    },
    "r0008": function (event, args) {
event.stopPropagation();obsEdit(args[0])
    },
    "r0009": function (event, args) {
showPage(args[0],null)
    },
    "r0010": function (event, args) {
dashNavigateTo(args[0])
    },
    "r0011": function (event, args) {
dashNavClick(event,args[0],args[1])
    },
    "r0012": function (event, args) {
dashNavClick(event,args[0])
    },
    "r0013": function (event, args) {
clientRolloutToggleCriterion(args[0])
    },
    "r0014": function (event, args) {
clientRolloutEditIssue(args[0])
    },
    "r0015": function (event, args) {
clientRolloutDeleteIssue(args[0])
    },
    "r0016": function (event, args) {
clientDecisionEdit(args[0])
    },
    "r0017": function (event, args) {
clientDecisionDelete(args[0])
    },
    "r0018": function (event, args) {
dashCloseDemoReview();showPage(args[0],null)
    },
    "r0019": function (event, args) {
event.stopPropagation();dashNavigateToMonth(args[0],args[1],'incident')
    },
    "r0020": function (event, args) {
event.stopPropagation();dashNavigateToMonth(args[0],args[1],'near_miss')
    },
    "r0021": function (event, args) {
dashNavigateToMonth(args[0],args[1],'all')
    },
    "r0022": function (event, args) {
aiLoadRAMS(args[0])
    },
    "r0023": function (event, args) {
evQuickClose(args[0])
    },
    "r0024": function (event, args) {
evStartInvestigation(args[0])
    },
    "r0025": function (event, args) {
noiseOpenSurvey(args[0])
    },
    "r0026": function (event, args) {
noisePrintSurvey(args[0])
    },
    "r0027": function (event, args) {
noiseSetActivePoint(args[0])
    },
    "r0028": function (event, args) {
event.stopPropagation();noiseRemovePoint(args[0])
    },
    "r0029": function (event, args) {
event.stopPropagation();noiseSetActivePoint(args[0])
    },
    "r0030": function (event, args) {
chemEdit(args[0])
    },
    "r0031": function (event, args) {
event.stopPropagation();chemEdit(args[0])
    },
    "r0032": function (event, args) {
swmsOpen(args[0])
    },
    "r0033": function (event, args) {
dcEdit(args[0]);showPage('documents',null)
    },
    "r0034": function (event, args) {
mtgClickWeek(this.dataset.seriesId,args[0])
    },
    "r0035": function (event, args) {
peopleOpenProfile(args[0])
    },
    "r0036": function (event, args) {
peopleEdit(args[0])
    },
    "r0037": function (event, args) {
peopleOnboardUser(args[0])
    },
    "r0038": function (event, args) {
peopleReactivate(args[0])
    },
    "r0039": function (event, args) {
peopleDeactivate(args[0])
    },
    "r0040": function (event, args) {
rolloutSaveCohort(args[0])
    },
    "r0041": function (event, args) {
relationshipRepairOpen(args[0],'source')
    },
    "r0042": function (event, args) {
relationshipRepairOpen(args[0],'target')
    },
    "r0043": function (event, args) {
relationshipRepairArchive(args[0])
    },
    "r0044": function (event, args) {
personIdentityResolve(args[0],'linked')
    },
    "r0045": function (event, args) {
personIdentityResolve(args[0],'ignored')
    },
    "r0046": function (event, args) {
customEditField(args[0])
    },
    "r0047": function (event, args) {
customDeleteField(args[0])
    },
    "r0048": function (event, args) {
approvalEditWorkflow(args[0])
    },
    "r0049": function (event, args) {
approvalDeleteWorkflow(args[0])
    },
    "r0050": function (event, args) {
brandPickPreset(args[0])
    },
    "r0051": function (event, args) {
event.stopPropagation();wsShowDetail(args[0])
    },
    "r0052": function (event, args) {
wsTbtAttendees[args[0]].signed=this.checked;tbtRenderAttendees()
    },
    "r0053": function (event, args) {
wsTbtAttendees.splice(args[0],1);tbtRenderAttendees()
    },
    "r0054": function (event, args) {
wsTEOpenChecklist(args[0])
    },
    "r0055": function (event, args) {
event.stopPropagation();wsTEOpenChecklist(args[0])
    },
    "r0056": function (event, args) {
event.stopPropagation();wsTERemove(args[0])
    },
    "r0057": function (event, args) {
event.stopPropagation();wsOpenLinkedRecord(args[0],args[1])
    },
    "r0058": function (event, args) {
wsLinkedRecordChanged(args[0],this.value)
    },
    "r0059": function (event, args) {
event.stopPropagation();wsOpenLinkedRecord(args[0])
    },
    "r0060": function (event, args) {
imsRemovePhoto(args[0])
    },
    "r0061": function (event, args) {
imsOpenInvestigation(args[0])
    },
    "r0062": function (event, args) {
navigator.clipboard.writeText(args[0]).then(()=>toast('Copied!'))
    },
    "r0063": function (event, args) {
event.stopPropagation();imsEditEvidence(args[0])
    },
    "r0064": function (event, args) {
event.stopPropagation();raOpen(args[0])
    },
    "r0065": function (event, args) {
event.stopPropagation();jsaEdit(args[0])
    },
    "r0066": function (event, args) {
raLegalRefs.splice(args[0],1);raRenderLegalRefs()
    },
    "r0067": function (event, args) {
raPreviewCompanyTemplate(args[0])
    },
    "r0068": function (event, args) {
raDeleteCompanyTemplate(args[0])
    },
    "r0069": function (event, args) {
raLoadTemplate(args[0])
    },
    "r0070": function (event, args) {
raAddFromLibrary(args[0])
    },
    "r0071": function (event, args) {
raAddSingleAISuggestion(args[0])
    },
    "r0072": function (event, args) {
event.stopPropagation();ptwShowDetail(args[0])
    },
    "r0073": function (event, args) {
ptwApprove(args[0],'approved')
    },
    "r0074": function (event, args) {
ptwApprove(args[0],'rejected')
    },
    "r0075": function (event, args) {
conOpenDetail(args[0])
    },
    "r0076": function (event, args) {
catwPersons.splice(args[0],1);catwRenderPersons()
    },
    "r0077": function (event, args) {
emPlanContacts.splice(args[0],1);emRenderPlanContacts()
    },
    "r0078": function (event, args) {
emPlanContacts[args[0]].name=this.value
    },
    "r0079": function (event, args) {
emPlanContacts[args[0]].role=this.value
    },
    "r0080": function (event, args) {
emPlanContacts[args[0]].phone=this.value
    },
    "r0081": function (event, args) {
emPlanContacts[args[0]].email=this.value
    },
    "r0082": function (event, args) {
emPlanResources[args[0]].type=this.value
    },
    "r0083": function (event, args) {
emPlanResources[args[0]].location=this.value
    },
    "r0084": function (event, args) {
emPlanResources.splice(args[0],1);emRenderPlanResources()
    },
    "r0085": function (event, args) {
event.stopPropagation();ppeCatEdit(args[0])
    },
    "r0086": function (event, args) {
ppeQuickReplace(args[0],args[1],args[2])
    },
    "r0087": function (event, args) {
toolsStartPersonalCheck(args[0])
    },
    "r0088": function (event, args) {
mapEdit(args[0])
    },
    "r0089": function (event, args) {
event.stopPropagation();mapOpenSourceRecord(args[0])
    },
    "r0090": function (event, args) {
this.style.background=args[0]
    },
    "r0091": function (event, args) {
this.style.background=args[0]
    },
    "r0092": function (event, args) {
event.stopPropagation();mapEdit(args[0])
    },
    "r0093": function (event, args) {
mapSetEffectiveness(args[0])
    },
    "r0094": function (event, args) {
mapApplyAISuggestion(args[0])
    },
    "r0095": function (event, args) {
event.stopPropagation();dcViewDocById(args[0])
    },
    "r0096": function (event, args) {
dcPreviewRevision(args[0])
    },
    "r0097": function (event, args) {
legalOpenReq(args[0])
    },
    "r0098": function (event, args) {
event.stopPropagation();calMarkComplete(args[0])
    },
    "r0099": function (event, args) {
event.stopPropagation();tbtEdit(args[0])
    },
    "r0100": function (event, args) {
event.stopPropagation();bulletinPreview(args[0])
    },
    "r0101": function (event, args) {
event.stopPropagation();bulletinEdit(args[0])
    },
    "r0102": function (event, args) {
event.stopPropagation();auditOpen(args[0])
    },
    "r0103": function (event, args) {
syncChk(args[0],'g')
    },
    "r0104": function (event, args) {
syncChk(args[0],'i')
    },
    "r0105": function (event, args) {
syncChk(args[0],'n')
    },
    "r0106": function (event, args) {
psOpen(args[0])
    },
    "r0107": function (event, args) {
usersProfileSwitch(args[0])
    },
    "r0108": function (event, args) {
usersCloseProfile();usersEdit(args[0])
    },
    "r0109": function (event, args) {
saCompanyPick(args[0])
    },
    "r0110": function (event, args) {
modulesMenuNavigate(args[0])
    },
    "r0111": function (event, args) {
adminEditCompany(args[0])
    },
    "r0112": function (event, args) {
openModuleAccess(args[0])
    },
    "r0113": function (event, args) {
adminNewSite(args[0])
    },
    "r0114": function (event, args) {
toggleModuleAccess(args[0], this.checked)
    },
    "r0115": function (event, args) {
integOpenConfig(args[0])
    },
    "r0116": function (event, args) {
event.stopPropagation();integOpenConfig(args[0])
    },
    "r0117": function (event, args) {
eleLaunchEnrolment(args[0])
    },
    "r0118": function (event, args) {
dashCompleteElearning(args[0])
    },
    "r0119": function (event, args) {
compEdit(args[0])
    },
    "r0120": function (event, args) {
indEdit(args[0])
    },
    "r0121": function (event, args) {
elcLaunch(args[0])
    },
    "r0122": function (event, args) {
elcEdit(args[0])
    },
    "r0123": function (event, args) {
eleQuickComplete(args[0])
    },
    "r0124": function (event, args) {
eleEdit(args[0])
    },
    "r0125": function (event, args) {
offlineRetryDraft(args[0])
    },
    "r0126": function (event, args) {
offlineDeleteDraft(args[0])
    },
    "r0127": function (event, args) {
notificationOpen(args[0])
    },
    "r0128": function (event, args) {
approvalsOpen(args[0])
    },
    "r0129": function (event, args) {
auditCopyDetails(args[0])
    },
    "r0130": function (event, args) {
obRemoveSite(args[0])
    },
    "r0131": function (event, args) {
fireShowCertForm(args[0])
    },
    "r0132": function (event, args) {
fireDeleteCert(args[0])
    },
    "r0133": function (event, args) {
fireShowInspForm(args[0])
    },
    "r0134": function (event, args) {
fireDeleteInsp(args[0])
    },
    "r0135": function (event, args) {
fireShowEquipForm(args[0])
    },
    "r0136": function (event, args) {
fireDeleteEquip(args[0])
    },
    "r0137": function (event, args) {
fireDeleteCustomSymbol(args[0])
    },
    "r0138": function (event, args) {
fireSelectLayoutPlan(args[0])
    },
    "r0139": function (event, args) {
event.stopPropagation();fireSelectLayoutPlan(args[0])
    },
    "r0140": function (event, args) {
smOpenPlan(args[0])
    },
    "r0141": function (event, args) {
event.stopPropagation();smOpenPlan(args[0])
    },
    "r0142": function (event, args) {
event.stopPropagation();smDeletePlan(args[0])
    },
    "r0143": function (event, args) {
smSelectSite(args[0])
    },
    "r0144": function (event, args) {
event.stopPropagation();smOpenLinkedPlan(args[0])
    },
    "r0145": function (event, args) {
event.stopPropagation();smSelectMapEvent(args[0])
    },
    "r0146": function (event, args) {
event.stopPropagation();smSelectMapRisk(args[0])
    },
    "r0147": function (event, args) {
smSetLinkedPlan(args[0],this.value)
    },
    "r0148": function (event, args) {
smOpenLinkedPlan(args[0])
    },
    "r0149": function (event, args) {
smUnlinkPlan(args[0])
    },
    "r0150": function (event, args) {
smCreateLinkedPlan(args[0])
    },
    "r0151": function (event, args) {
this.parentNode.parentNode.remove()
    },
    "r0152": function (event, args) {
showPage('moc',this)
    }
  };
  var namedActions = {
    'obs-new': function () { obsNew(this.dataset.observationType || undefined); },
    'ims-scroll-register': function () { imsScrollIncidentRegister(); },
    'ims-open-investigations': function () { imsOpenTabById('investigate', 'ims-tab-investigate'); },
    'ims-open-actions': function () { imsOpenTabById('actions', 'ims-tab-actions'); },
    'ims-filter-closed': function () { imsSetFilterAndRender('ev-filter-status', 'closed'); },
    'ims-open-stats': function () { imsOpenIncidentStats(); },
    'ra-form-tab': function () { raFormTab(this.dataset.raTab, this); },
    'ra-add-all-suggestions': function () { raAddAllAISuggestions(window._raAISuggestions || []); },
    'ptw-open-gas': function () { ptwOpenGasPanel(); },
    'ptw-open-isolation': function () { ptwOpenIsolationPanel(); },
    'ptw-open-approval': function () { ptwOpenApprovalPanel(); },
    'ptw-activate': function () { ptwActivate(); },
    'ptw-open-closure': function () { ptwOpenClosurePanel(); },
    'ptw-open-suspension': function () { ptwOpenSuspensionPanel(); },
    'ptw-resume': function () { ptwResume(); },
    'map-start': function () { mapChangeStatus('in_progress'); },
    'map-submit-verification': function () { mapChangeStatus('pending_verification'); },
    'map-submit-closure': function () { mapChangeStatus('pending_closure'); },
    'map-approve-verification': function () { mapApproveVerification(); },
    'map-approve-closure': function () { mapApproveClosure(); },
    'map-escalate': function () { mapFormTab('assignment', document.getElementById('map-ftab-assignment')); },
    'map-cancel': function () { mapChangeStatus('cancelled'); },
    'dc-submit': function () { dcSubmitForApproval(); },
    'dc-approve': function () { dcApprove(); },
    'dc-reject': function () { dcReject(); },
    'dc-new-revision': function () { dcCreateNewRevision(); },
    'dc-issue-ack': function () { dcFormTab('ack', document.getElementById('dc-ftab-ack')); dcIssueAck(); },
    'copy-created-credentials': function (event, args) {
      navigator.clipboard.writeText('Username: ' + (args[0] || '') + '\nPassword: ' + (args[1] || ''))
        .then(function () { toast('Copied to clipboard'); });
    },
    'admin-switch-site': function () {
      var id = this.dataset.id;
      adminSwitchSite(id);
      var switcher = document.getElementById('adm3site-switcher');
      if (switcher) switcher.value = id;
      var site = adminSitesData.find(function (item) { return item.id === id; });
      toast('Viewing: ' + (site?.name || 'Site'));
    },
    'mobile-nav': function () { mobileNavTo(this.dataset.page, this.dataset.label, this); }
  };
  var eventTypes = ["change","click","input","mouseout","mouseover"];

  function readArgs(node) {
    var encodedArgs = node.getAttribute('data-auris-runtime-args') || '%5B%5D';
    return JSON.parse(decodeURIComponent(encodedArgs));
  }

  function dispatch(eventType, event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var handlerAttribute = 'data-auris-runtime-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(handlerAttribute);
      if (handlerId && handlers[handlerId]) {
        var args = readArgs(node);
        var result = handlers[handlerId].call(node, event, args);
        if (result === false) event.preventDefault();
      }
      if (eventType === 'click') {
        var namedActionId = node.getAttribute('data-auris-named-action');
        if (namedActionId && namedActions[namedActionId]) {
          var namedResult = namedActions[namedActionId].call(node, event, readArgs(node));
          if (namedResult === false) event.preventDefault();
        }
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
