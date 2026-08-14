(function () {
  'use strict';
  var handlers = {
    "e0001": function (event, args) {
trainingPrintCurrentView()
    },
    "e0002": function (event, args) {
lcuPrimaryAction()
    },
    "e0003": function (event, args) {
lcuSwitch(args[0])
    },
    "e0004": function (event, args) {
lcuSwitch('mylearning')
    },
    "e0005": function (event, args) {
lcuSwitch('catalogue')
    },
    "e0006": function (event, args) {
lcuSwitch('studio')
    },
    "e0007": function (event, args) {
if(event.target===this)lcuCloseDrawer()
    },
    "e0008": function (event, args) {
lcuCloseDrawer()
    },
    "e0009": function (event, args) {
lcuSwitch('inductions')
    },
    "e0010": function (event, args) {
lcuReviewSourceImpact(args[0],args[1])
    },
    "e0011": function (event, args) {
elcLaunch(args[0])
    },
    "e0012": function (event, args) {
lcuOpenGovernance(args[0])
    },
    "e0013": function (event, args) {
elcNew()
    },
    "e0014": function (event, args) {
lcuOpenAssessment(args[0])
    },
    "e0015": function (event, args) {
lcuOpenAssessment()
    },
    "e0016": function (event, args) {
lcuOpenPlan(args[0])
    },
    "e0017": function (event, args) {
lcuSwitch('sessions')
    },
    "e0018": function (event, args) {
lcuSwitch('external')
    },
    "e0019": function (event, args) {
lcuSwitch('elearning')
    },
    "e0020": function (event, args) {
lcuOpenProvider(args[0])
    },
    "e0021": function (event, args) {
lcuNewExternal()
    },
    "e0022": function (event, args) {
lcuOpenProvider()
    },
    "e0023": function (event, args) {
lcuSaveGovernance(args[0],args[1])
    },
    "e0024": function (event, args) {
lcuSaveProvider(args[0])
    },
    "e0025": function (event, args) {
lcuSaveAssessment(args[0])
    },
    "e0026": function (event, args) {
if(event.target===this)bbsCloseDrawer()
    },
    "e0027": function (event, args) {
bbsSwitchTab(args[0])
    },
    "e0028": function (event, args) {
bbsSwitchTab('dashboard')
    },
    "e0029": function (event, args) {
bbsSwitchTab('observe')
    },
    "e0030": function (event, args) {
bbsSwitchTab('my')
    },
    "e0031": function (event, args) {
bbsSwitchTab('register')
    },
    "e0032": function (event, args) {
bbsOpenObservation(args[0])
    },
    "e0033": function (event, args) {
bbsOpenEntity('programmes',args[0])
    },
    "e0034": function (event, args) {
bbsOpenEntity('items',args[0])
    },
    "e0035": function (event, args) {
bbsOpenEntity('feedback',args[0])
    },
    "e0036": function (event, args) {
bbsOpenAction(args[0])
    },
    "e0037": function (event, args) {
bbsCreateAction(args[0])
    },
    "e0038": function (event, args) {
bbsOpenEntity('recognitions',args[0])
    },
    "e0039": function (event, args) {
bbsGenerateReport(args[0])
    },
    "e0040": function (event, args) {
bbsConfigGroup(args[0])
    },
    "e0041": function (event, args) {
bbsCloseDrawer()
    },
    "e0042": function (event, args) {
bbsReview(args[0],'returned')
    },
    "e0043": function (event, args) {
bbsReview(args[0],'redirected')
    },
    "e0044": function (event, args) {
bbsReview(args[0],'accepted')
    },
    "e0045": function (event, args) {
bbsSaveProgramme()
    },
    "e0046": function (event, args) {
bbsSaveBehaviour()
    },
    "e0047": function (event, args) {
bbsSaveRecognition()
    },
    "e0048": function (event, args) {
bbsSaveReport()
    },
    "e0049": function (event, args) {
bbsSaveTheme()
    },
    "e0050": function (event, args) {
bbsSaveFeedback()
    },
    "e0051": function (event, args) {
bbsEntityTransition(args[0],args[1],'review')
    },
    "e0052": function (event, args) {
bbsEntityTransition(args[0],args[1],'published')
    },
    "e0053": function (event, args) {
bbsCommitAction(args[0])
    },
    "e0054": function (event, args) {
window.aurisExecuteModuleCommand(this.getAttribute('data-auris-module-command') || '', 'bbs')
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
