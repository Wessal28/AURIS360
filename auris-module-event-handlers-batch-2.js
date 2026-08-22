(function () {
  'use strict';
  var handlers = {
    "c0001": function (event, args) {
dcxSwitch(args[0])
    },
    "c0002": function (event, args) {
dcxSwitch('mywork')
    },
    "c0003": function (event, args) {
dcxOpenWizard()
    },
    "c0004": function (event, args) {
dcxReload()
    },
    "c0005": function (event, args) {
dcxCloseDrawer()
    },
    "c0006": function (event, args) {
dcxOpenDocument(args[0])
    },
    "c0007": function (event, args) {
dcxResetFilters()
    },
    "c0008": function (event, args) {
dcxConfigWorkspace(args[0])
    },
    "c0009": function (event, args) {
dcxDocumentTab(args[0])
    },
    "c0010": function (event, args) {
dcxOpenRecord(args[0])
    },
    "c0011": function (event, args) {
dcxWizardChanged()
    },
    "c0012": function (event, args) {
dcxWizardChanged()
    },
    "c0013": function (event, args) {
dcxConfigChanged()
    },
    "c0014": function (event, args) {
dcxConfigChanged()
    },
    "c0015": function (event, args) {
raPrintCurrentView()
    },
    "c0016": function (event, args) {
raImportExistingPDF('task')
    },
    "c0017": function (event, args) {
raShowNewPanel()
    },
    "c0018": function (event, args) {
raxSwitch('dashboard')
    },
    "c0019": function (event, args) {
raxSwitch('register')
    },
    "c0020": function (event, args) {
raxSwitch('mywork')
    },
    "c0021": function (event, args) {
raShowLibrary()
    },
    "c0022": function (event, args) {
raxSaved('all')
    },
    "c0023": function (event, args) {
raxSaved('mine')
    },
    "c0024": function (event, args) {
raxSaved('high')
    },
    "c0025": function (event, args) {
raxSaved('due')
    },
    "c0026": function (event, args) {
raxSaved('archived')
    },
    "c0027": function (event, args) {
raOpen(args[0])
    },
    "c0028": function (event, args) {
raxHeatCell(args[0],args[1])
    },
    "c0029": function (event, args) {
raxSaved('high');raxSwitch('register')
    },
    "c0030": function (event, args) {
raFormTab('assurance',this)
    },
    "c0031": function (event, args) {
raxOpenVerification()
    },
    "c0032": function (event, args) {
raxOpenLink()
    },
    "c0033": function (event, args) {
if(event.target===this)raxCloseDrawer()
    },
    "c0034": function (event, args) {
raxCloseDrawer()
    },
    "c0035": function (event, args) {
raxSaveVerification()
    },
    "c0036": function (event, args) {
raxSaveLink()
    },
    "c0037": function (event, args) {
if(event.target===this)ccuCloseDrawer()
    },
    "c0038": function (event, args) {
ccuCloseDrawer()
    },
    "c0039": function (event, args) {
ccuPrint()
    },
    "c0040": function (event, args) {
ccuPrimaryAction()
    },
    "c0041": function (event, args) {
ccuSwitch(args[0])
    },
    "c0042": function (event, args) {
ccuSaveSdsVersion()
    },
    "c0043": function (event, args) {
ccuSwitch('reviews')
    },
    "c0044": function (event, args) {
ccuOpenUse(args[0])
    },
    "c0045": function (event, args) {
ccuOpenUse()
    },
    "c0046": function (event, args) {
ccuOpenInventory(args[0])
    },
    "c0047": function (event, args) {
ccuOpenInventory()
    },
    "c0048": function (event, args) {
ccuEditChemical(args[0])
    },
    "c0049": function (event, args) {
ccuSaveUse(args[0])
    },
    "c0050": function (event, args) {
ccuSaveInventory()
    },
    "c0051": function (event, args) {
window.aurisExecuteModuleCommand(this.getAttribute('data-auris-module-command') || '', 'dcx')
    },
    "c0052": function (event, args) {
ccuGenerateRiskAssessment(args[0])
    }
  };
  var eventTypes = ["change","click","input"];

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
