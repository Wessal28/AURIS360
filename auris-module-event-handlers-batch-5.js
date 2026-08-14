(function () {
  'use strict';
  var handlers = {
    "f0001": function (event, args) {
if(event.target===this)seCloseDrawer()
    },
    "f0002": function (event, args) {
seSwitchTab(args[0])
    },
    "f0003": function (event, args) {
seSwitchTab('monthly')
    },
    "f0004": function (event, args) {
seOpenDrawer('calculation',args[0],args[1])
    },
    "f0005": function (event, args) {
seOpenDrawer('person',args[0])
    },
    "f0006": function (event, args) {
seOpenDrawer('month',args[0])
    },
    "f0007": function (event, args) {
seOpenDrawer('validation',args[0])
    },
    "f0008": function (event, args) {
seGenerateReport(args[0])
    },
    "f0009": function (event, args) {
seConfigFilter(args[0])
    },
    "f0010": function (event, args) {
seConfirmQr()
    },
    "f0011": function (event, args) {
seSaveHazard(false)
    },
    "f0012": function (event, args) {
seSubmitHazard()
    },
    "f0013": function (event, args) {
seSyncDrafts()
    },
    "f0014": function (event, args) {
seOpenMobile('hazard')
    },
    "f0015": function (event, args) {
seOpenMobile('qr')
    },
    "f0016": function (event, args) {
seOpenMobile('performance')
    },
    "f0017": function (event, args) {
seOpenMobile('calendar')
    },
    "f0018": function (event, args) {
seSwitchTab('dashboard')
    },
    "f0019": function (event, args) {
seOpenMobile(args[0])
    },
    "f0020": function (event, args) {
seCloseDrawer()
    },
    "f0021": function (event, args) {
seTransition('programmes',args[0],'published')
    },
    "f0022": function (event, args) {
seTransition('programmes',args[0],'inactive')
    },
    "f0023": function (event, args) {
seTransition('assignments',args[0],'active')
    },
    "f0024": function (event, args) {
seTransition('assignments',args[0],'ended')
    },
    "f0025": function (event, args) {
seTransition(args[0],args[1],'published')
    },
    "f0026": function (event, args) {
seTransition('recognitions',args[0],'approved')
    },
    "f0027": function (event, args) {
seTransition('recognitions',args[0],'declined')
    },
    "f0028": function (event, args) {
seTransition('recognitions',args[0],'issued')
    },
    "f0029": function (event, args) {
seTransition('coaching',args[0],'active')
    },
    "f0030": function (event, args) {
seTransition('coaching',args[0],'completed')
    },
    "f0031": function (event, args) {
seTransition('coaching',args[0],'cancelled')
    },
    "f0032": function (event, args) {
seTransition('disputes',args[0],'withdrawn')
    },
    "f0033": function (event, args) {
seOpenDrawer('record-view',args[0],args[1])
    },
    "f0034": function (event, args) {
seOpenDrawer('record-edit',args[0],args[1])
    },
    "f0035": function (event, args) {
seRecordAction(args[0],args[1],'duplicate')
    },
    "f0036": function (event, args) {
seOpenDrawer('history',args[0],args[1])
    },
    "f0037": function (event, args) {
seRecordAction(args[0],args[1],args[2])
    },
    "f0038": function (event, args) {
seSaveProgramme()
    },
    "f0039": function (event, args) {
seSaveAssignment()
    },
    "f0040": function (event, args) {
seSaveDispute()
    },
    "f0041": function (event, args) {
seSaveRecognition()
    },
    "f0042": function (event, args) {
seSaveCoaching()
    },
    "f0043": function (event, args) {
seValidationDecision(args[0],'request_info')
    },
    "f0044": function (event, args) {
seValidationDecision(args[0],'rejected')
    },
    "f0045": function (event, args) {
seValidationDecision(args[0],'accepted')
    },
    "f0046": function (event, args) {
seMonthApprove(args[0])
    },
    "f0047": function (event, args) {
toastMsg('Preferences saved');seCloseDrawer()
    },
    "f0048": function (event, args) {
seSaveEntity('programmes',null,'draft')
    },
    "f0049": function (event, args) {
seSaveEntity('programmes',null,'review')
    },
    "f0050": function (event, args) {
seSaveKpi()
    },
    "f0051": function (event, args) {
seSaveEntity('assignments',null,'pending')
    },
    "f0052": function (event, args) {
seSaveEntity('reports',null,'draft')
    },
    "f0053": function (event, args) {
seSaveReviewTemplate('draft')
    },
    "f0054": function (event, args) {
seSaveReviewTemplate('published')
    },
    "f0055": function (event, args) {
sePreviewConfig()
    },
    "f0056": function (event, args) {
seSaveEntity('configRecords',null,'draft')
    },
    "f0057": function (event, args) {
seSaveEntity(args[0],args[1],args[2])
    },
    "f0058": function (event, args) {
seImportPreview()
    },
    "f0059": function (event, args) {
seReviewStep(args[0])
    },
    "f0060": function (event, args) {
seSaveTeamReview(false)
    },
    "f0061": function (event, args) {
seSaveTeamReview(true)
    },
    "f0062": function (event, args) {
window.aurisExecuteModuleCommand(this.getAttribute('data-auris-module-command') || '', 'se')
    },
    "f0063": function (event, args) {
showPage('engagement',this)
    }
  };
  var eventTypes = ["click"];

  function dispatch(eventType, event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var attribute = 'data-auris-module-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(attribute);
      if (handlerId && handlers[handlerId]) {
        var encodedArgs = node.getAttribute('data-auris-module-args') || '%5B%5D';
        var args = JSON.parse(decodeURIComponent(encodedArgs));
        var result = handlers[handlerId].call(node, event, args);
        if (result === false) event.preventDefault();
      }
      if (event.cancelBubble) break;
      node = node.parentElement;
    }
  }

  eventTypes.forEach(function (eventType) {
    document.addEventListener(eventType, function (event) { dispatch(eventType, event); }, eventType === 'error');
  });
})();
