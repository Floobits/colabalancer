var http = require("http");
var util = require("util");

var async = require("async");
var request = require("request");
var _ = require("lodash");

var log = require("./log");
var settings = require("./settings");

request = request.defaults({
  sendImmediately: true
});


var ColaBalancerServer = function () {
  var self = this;
};

ColaBalancerServer.prototype.listen = function () {
  var self = this;
};

ColaBalancerServer.prototype.stop = function () {
  var self = this;

  log.log("Closing server...");
  self.server.close();
  log.log("Done closing server.");
};


exports.run = function () {
  var self = this,
    server;

  log.set_log_level(settings.log_level);

  server = new ColaBalancerServer();

  function shut_down(sig) {
    log.log("caught signal: ", sig);
    server.stop();
  }

  process.on("SIGTERM", function () {shut_down("SIGTERM"); });
  process.on("SIGINT", function () {shut_down("SIGINT"); });

  process.on("SIGHUP", function (sig) {
    //TODO: reload
  });

  server.listen();
};
