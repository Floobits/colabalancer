var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var tls = require("tls");
var util = require("util");

var async = require("async");
var request = require("request");
var _ = require("lodash");

var log = require("./log");
var settings = require("./settings");

request = request.defaults({
  sendImmediately: true
});


var ProxyConnection = function (id, conn, server) {
  var self = this,
    url;

  url = util.format("%s/r/%s/%s");
  request.get(url);
};


module.exports = {
  ProxyConnection: ProxyConnection
};
