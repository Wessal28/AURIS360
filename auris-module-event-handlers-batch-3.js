(function () {
  'use strict';
  var handlers = {
    "d0001": function (event, args) {
kpiXFilterStatus(args[0])
    },
    "d0002": function (event, args) {
kpiXFilterObjective(args[0])
    },
    "d0003": function (event, args) {
kpiXOpenDrawer(args[0])
    },
    "d0004": function (event, args) {
kpiXReviewExceptions()
    },
    "d0005": function (event, args) {
kpiXSwitchTab('scorecard')
    },
    "d0006": function (event, args) {
kpiXReviewMissing()
    },
    "d0007": function (event, args) {
kpiXCreateAction(args[0])
    },
    "d0008": function (event, args) {
kpiPrint()
    },
    "d0009": function (event, args) {
kpiXExportCsv()
    },
    "d0010": function (event, args) {
kpiLoadAll()
    },
    "d0011": function (event, args) {
openKpiAddModal()
    },
    "d0012": function (event, args) {
kpiXSubmitMonth()
    },
    "d0013": function (event, args) {
kpiXSetSearch(this.value)
    },
    "d0014": function (event, args) {
kpiXSetObjective(this.value)
    },
    "d0015": function (event, args) {
kpiXSetOwner(this.value)
    },
    "d0016": function (event, args) {
kpiXFilterStatus(this.value)
    },
    "d0017": function (event, args) {
kpiXSetFrequency(this.value)
    },
    "d0018": function (event, args) {
kpiXResetFilters()
    },
    "d0019": function (event, args) {
kpiXSwitchTab(args[0])
    },
    "d0020": function (event, args) {
kpiXSetPeriod('monthly',this)
    },
    "d0021": function (event, args) {
kpiXSetPeriod('quarterly',this)
    },
    "d0022": function (event, args) {
kpiXSetPeriod('annual',this)
    },
    "d0023": function (event, args) {
document.getElementById('kpi-x-drawer').remove()
    },
    "d0024": function (event, args) {
kpiXGoMonthly(args[0])
    },
    "d0025": function (event, args) {
swxPrintRegister()
    },
    "d0026": function (event, args) {
swmsNew()
    },
    "d0027": function (event, args) {
swxSwitch(args[0])
    },
    "d0028": function (event, args) {
swxApplyRegisterFilters()
    },
    "d0029": function (event, args) {
swxApplyRegisterFilters()
    },
    "d0030": function (event, args) {
swxResetRegister()
    },
    "d0031": function (event, args) {
if(event.target===this)swxCloseDrawer()
    },
    "d0032": function (event, args) {
swxCloseDrawer()
    },
    "d0033": function (event, args) {
swxSwitch('register')
    },
    "d0034": function (event, args) {
swxOpenRecord(args[0])
    },
    "d0035": function (event, args) {
swxOpenRecordForm(args[0])
    },
    "d0036": function (event, args) {
swmsOpen(args[0])
    },
    "d0037": function (event, args) {
swxSaveRecord(args[0])
    },
    "d0038": function (event, args) {
swxOpenRecordForm(args[0],args[1])
    },
    "d0039": function (event, args) {
if(event.target===this)cmuCloseDrawer()
    },
    "d0040": function (event, args) {
cmuCloseDrawer()
    },
    "d0041": function (event, args) {
cmuPrint()
    },
    "d0042": function (event, args) {
cmuPrimaryAction()
    },
    "d0043": function (event, args) {
cmuSwitch(args[0])
    },
    "d0044": function (event, args) {
cmuSaveProfile()
    },
    "d0045": function (event, args) {
cmuOpenMobilisation(args[0])
    },
    "d0046": function (event, args) {
cmuSwitch('mobilisation')
    },
    "d0047": function (event, args) {
cmuOpenPackage(args[0])
    },
    "d0048": function (event, args) {
cmuOpenPackage()
    },
    "d0049": function (event, args) {
cmuOpenDocument(args[0])
    },
    "d0050": function (event, args) {
cmuOpenDocument()
    },
    "d0051": function (event, args) {
cmuSavePackage(args[0])
    },
    "d0052": function (event, args) {
cmuGateChanged(this)
    },
    "d0053": function (event, args) {
cmuInitialiseGates(args[0])
    },
    "d0054": function (event, args) {
cmuSaveGate(args[0])
    },
    "d0055": function (event, args) {
cmuSaveDocument(args[0])
    },
    "d0056": function (event, args) {
if(event.target===this)teuCloseDrawer()
    },
    "d0057": function (event, args) {
teuCloseDrawer()
    },
    "d0058": function (event, args) {
teuPrint()
    },
    "d0059": function (event, args) {
teuPrimaryAction()
    },
    "d0060": function (event, args) {
teuSwitch(args[0])
    },
    "d0061": function (event, args) {
teuOpenProfile(args[0])
    },
    "d0062": function (event, args) {
teuSwitch('assurance')
    },
    "d0063": function (event, args) {
teuOpenReturn()
    },
    "d0064": function (event, args) {
teuOpenMovement()
    },
    "d0065": function (event, args) {
teuOpenAssurance(args[0])
    },
    "d0066": function (event, args) {
teuOpenAssurance()
    },
    "d0067": function (event, args) {
teuOpenMaintenance(args[0])
    },
    "d0068": function (event, args) {
teuOpenMaintenance()
    },
    "d0069": function (event, args) {
teuOpenDefect(args[0])
    },
    "d0070": function (event, args) {
teuOpenDefect()
    },
    "d0071": function (event, args) {
teuSaveProfile(args[0])
    },
    "d0072": function (event, args) {
teuSaveMovement()
    },
    "d0073": function (event, args) {
teuSaveReturn()
    },
    "d0074": function (event, args) {
teuSaveAssurance(args[0])
    },
    "d0075": function (event, args) {
teuSaveMaintenance(args[0])
    },
    "d0076": function (event, args) {
teuSaveDefect(args[0])
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
