"use strict";

var fs = require("fs");
var path = require("path");
var util = require("util");

var _ = require("lodash");

/*eslint-disable no-sync */
function create_local_settings(old_dir) {
  if (fs.existsSync(path.join(old_dir, "local_settings.js"))) {
    console.log("local_settings already exists. No need to migrate.");
    return;
  }

  let old_settings = require(path.join(old_dir, "settings.js"));
  // Create an empty file so settings.js doesn't explode
  fs.writeFileSync(path.join(__dirname, "local_settings.js"), "");
  let new_settings = require("./settings.js");
  let local_settings = {};

  _.each(old_settings, function (v, k) {
    if (_.isEqual(v, new_settings[k])) {
      return;
    }
    console.log("Migrating", k);
    local_settings[k] = v;
  });

  local_settings = util.format("module.exports = %s;", JSON.stringify(local_settings, null, "  "));
  fs.writeFileSync(path.join(old_dir, "local_settings.js"), local_settings);
}
/*eslint-enable no-sync */

let colabalancer_path = "/data/colabalancer/lib";

if (process.argv.length === 3) {
  colabalancer_path = process.argv[2];
} else if (process.argv.length > 3) {
  throw new Error(util.format("Usage: node %s [path]", process.argv[1]));
}

create_local_settings(colabalancer_path);
