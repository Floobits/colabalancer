var fs = require("fs");
var path = require("path");
var util = require("util");

var _ = require("lodash");

var old_dir;

if (process.argv.length == 2) {
  old_dir = "/data/colabalancer/lib";
} else if (process.argv.length == 3) {
  old_dir = process.argv[2];
} else {
  console.log(util.format("Usage: node %s [path]", process.argv[1]));
  process.exit(1);
}

if (fs.exists(path.join(old_dir, "local_settings.js"))) {
  console.log("local_settings already exists. No need to migrate.");
  process.exit(0);
}

var old_settings = require(path.join(old_dir, "settings.js"));
var new_settings = require("./settings.js");
var local_settings = {};

_.each(old_settings, function (v, k) {
  if (v != new_settings[k]) {
    local_settings[k] = v;
  }
});

local_settings = util.format("module.exports = %s;", JSON.stringify(local_settings, null, "  "));
/*jslint stupid: true */
fs.writeFileSync(path.join(old_dir, "local_settings.js"), local_settings);
/*jslint stupid: false */
