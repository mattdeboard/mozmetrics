var contextMenu = require("context-menu");
var selection = require("selection");
var translator = require("translator");

exports.main = function(options, callbacks) {
  console.log(options.loadReason);
  
  var menuItem = contextMenu.Item({
    label: "Sync Now",
    context: contextMenu.SelectionContext(),
    contentScript: 'alert("Worked!")',
  });
};

exports.onUnload = function(reason) {
  console.log(reason);
};