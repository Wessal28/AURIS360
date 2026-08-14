(function () {
  'use strict';
  var handlers = {
    "b0001": function (event, args) {
kpiConfigChange(this)
    },
    "b0002": function (event, args) {
kpiConfigChange(this)
    },
    "b0003": function (event, args) {
kpiConfigDiscard()
    },
    "b0004": function (event, args) {
kpiConfigSave()
    },
    "b0005": function (event, args) {
kpiConfigValidate()
    },
    "b0006": function (event, args) {
kpiConfigPublish()
    },
    "b0007": function (event, args) {
kpiConfigSection(args[0])
    },
    "b0008": function (event, args) {
noiseSwitchTab(args[0])
    },
    "b0009": function (event, args) {
if(event.target===this)noiseCloseDrawer()
    },
    "b0010": function (event, args) {
noiseSwitchTab('dashboard')
    },
    "b0011": function (event, args) {
noiseSwitchTab('work')
    },
    "b0012": function (event, args) {
noiseSwitchTab('measurements')
    },
    "b0013": function (event, args) {
noiseSwitchTab('assessments')
    },
    "b0014": function (event, args) {
noiseConfigGroup(args[0])
    },
    "b0015": function (event, args) {
noiseCloseDrawer()
    },
    "b0016": function (event, args) {
imv2SwitchTab(args[0])
    },
    "b0017": function (event, args) {
imv2SwitchTab(args[0],this)
    },
    "b0018": function (event, args) {
imv2CloseDrawer()
    },
    "b0019": function (event, args) {
imv2SaveDraft()
    },
    "b0020": function (event, args) {
imv2InvTab(args[0],this)
    },
    "b0021": function (event, args) {
legalPrintCurrentView()
    },
    "b0022": function (event, args) {
legalNewFromTab()
    },
    "b0023": function (event, args) {
legalSwitchTab('mywork',this)
    },
    "b0024": function (event, args) {
legalSwitchTab('evidence',this)
    },
    "b0025": function (event, args) {
legalSwitchTab('permits',this)
    },
    "b0026": function (event, args) {
if(event.target===this)legxCloseDrawer()
    },
    "b0027": function (event, args) {
legxCloseDrawer()
    },
    "b0028": function (event, args) {
legxApplicabilityChanged()
    },
    "b0029": function (event, args) {
legxOpenRecord(args[0])
    },
    "b0030": function (event, args) {
legxOpenRecordForm(args[0])
    },
    "b0031": function (event, args) {
legxSaveRecord(args[0])
    },
    "b0032": function (event, args) {
sopPrintRegister()
    },
    "b0033": function (event, args) {
sopNew()
    },
    "b0034": function (event, args) {
sovSwitch('dashboard')
    },
    "b0035": function (event, args) {
sovSwitch('library')
    },
    "b0036": function (event, args) {
sovSwitch('review')
    },
    "b0037": function (event, args) {
sovSwitch('approvals')
    },
    "b0038": function (event, args) {
sovSwitch('templates')
    },
    "b0039": function (event, args) {
sovSaveWorkspace()
    },
    "b0040": function (event, args) {
sovSaveEvidence()
    },
    "b0041": function (event, args) {
sovFocusProject(args[0])
    },
    "b0042": function (event, args) {
sovOpenProject(args[0])
    },
    "b0043": function (event, args) {
elcPathAddLesson()
    },
    "b0044": function (event, args) {
elcPathAddQuestion()
    },
    "b0045": function (event, args) {
elcPathToggleQuiz(this.checked)
    },
    "b0046": function (event, args) {
elcPathRemoveLesson(args[0])
    },
    "b0047": function (event, args) {
elcPathRemoveQuestion(args[0])
    },
    "b0048": function (event, args) {
eleCloseVideoPlayer()
    },
    "b0049": function (event, args) {
window._eleCourseGo(args[0])
    },
    "b0050": function (event, args) {
return false
    },
    "b0051": function (event, args) {
aurisStopResilienceSimulation()
    },
    "b0052": function (event, args) {
aurisStartResilienceSimulation()
    },
    "b0053": function (event, args) {
runOfflineSyncDiagnostic()
    },
    "b0054": function (event, args) {
clearOfflineSyncDiagnostic()
    },
    "b0055": function (event, args) {
runRollbackRehearsal()
    },
    "b0056": function (event, args) {
clearRollbackRehearsal()
    },
    "b0057": function (event, args) {
notificationCentreOpen(args[0])
    },
    "b0058": function (event, args) {
event.stopPropagation();notificationCentreOpen(args[0])
    },
    "b0059": function (event, args) {
event.stopPropagation();notificationCentreAcknowledge(args[0])
    },
    "b0060": function (event, args) {
event.stopPropagation();notificationCentreMarkRead(args[0])
    },
    "b0061": function (event, args) {
notificationCentreMarkAllRead()
    },
    "b0062": function (event, args) {
notificationCentreRefresh(true)
    },
    "b0063": function (event, args) {
notificationCentreClose()
    },
    "b0064": function (event, args) {
notificationCentrePushToggle()
    },
    "b0065": function (event, args) {
notificationCentreFilter(args[0])
    },
    "b0066": function (event, args) {
executeModuleCommand(this.getAttribute('data-auris-module-command') || '')
    },
    "b0067": function (event, args) {
imv2ConfigGroup(args[0])
    }
  };
  var eventTypes = ["change","click","contextmenu","input"];

  function splitTopLevel(source, delimiter) {
    var parts = [], start = 0, quote = '', escaped = false, depth = 0;
    for (var index = 0; index < source.length; index += 1) {
      var character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === "'" || character === '"') quote = character;
      else if (character === '(' || character === '{' || character === '[') depth += 1;
      else if (character === ')' || character === '}' || character === ']') depth -= 1;
      else if (character === delimiter && depth === 0) {
        parts.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(source.slice(start).trim());
    return parts.filter(Boolean);
  }

  function parseCommandValue(source) {
    source = source.trim();
    if (!source) return undefined;
    if (source === 'true') return true;
    if (source === 'false') return false;
    if (source === 'null') return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(source)) return Number(source);
    if ((source[0] === "'" && source[source.length - 1] === "'") ||
        (source[0] === '"' && source[source.length - 1] === '"')) {
      var quote = source[0], output = '', escaped = false;
      for (var index = 1; index < source.length - 1; index += 1) {
        var character = source[index];
        if (escaped) { output += character === 'n' ? '\n' : character === 'r' ? '\r' : character === 't' ? '\t' : character; escaped = false; }
        else if (character === '\\') escaped = true;
        else output += character;
      }
      if (escaped || source[source.length - 1] !== quote) throw new Error('Malformed quoted command value');
      return output;
    }
    if (source[0] === '{' && source[source.length - 1] === '}') {
      var object = {};
      splitTopLevel(source.slice(1, -1), ',').forEach(function (entry) {
        var pair = splitTopLevel(entry, ':');
        if (pair.length !== 2 || !/^[A-Za-z_$][\w$]*$/.test(pair[0])) throw new Error('Unsupported command object');
        object[pair[0]] = parseCommandValue(pair[1]);
      });
      return object;
    }
    throw new Error('Unsupported command argument');
  }

  function executeModuleCommand(encodedCommand) {
    var command = decodeURIComponent(encodedCommand);
    splitTopLevel(command, ';').forEach(function (statement) {
      var match = /^([A-Za-z_$][\w$]*)\((.*)\)$/.exec(statement);
      if (!match || !/^(?:noise|imv2)[A-Z]\w*$/.test(match[1])) throw new Error('Rejected module command');
      var target = window[match[1]];
      if (typeof target !== 'function') throw new Error('Unknown module command');
      var commandArgs = splitTopLevel(match[2], ',').map(parseCommandValue).filter(function (value) { return value !== undefined; });
      target.apply(window, commandArgs);
    });
  }

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
