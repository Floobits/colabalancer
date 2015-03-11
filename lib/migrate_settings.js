/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var path = require("path");
var util = require("util");

var _ = require("lodash");

var old_dir;

/*eslint-disable no-sync */
if (process.argv.length === 2) {
  old_dir = "/data/colabalancer/lib";
} else if (process.argv.length === 3) {
  old_dir = process.argv[2];
} else {
  console.log(util.format("Usage: node %s [path]", process.argv[1]));
  process.exit(1);
}

if (fs.existsSync(path.join(old_dir, "local_settings.js"))) {
  console.log("local_settings already exists. No need to migrate.");
  process.exit(0);
}

let old_settings = require(path.join(old_dir, "settings.js"));
// Create an empty file so setting.sjs doesn't explode
fs.writeFileSync(path.join(__dirname, "local_settings.js"), "");
let new_settings = require("./settings.js");
let local_settings = {};

_.each(old_settings, function (v, k) {
  if (v !== new_settings[k]) {
    console.log("Migrating", k);
    local_settings[k] = v;
  }
});

local_settings = util.format("module.exports = %s;", JSON.stringify(local_settings, null, "  "));
fs.writeFileSync(path.join(old_dir, "local_settings.js"), local_settings);
/*eslint-enable no-sync */
