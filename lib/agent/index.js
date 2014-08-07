/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var base = require("./base");
var proxy = require("./proxy");
var engine_io = require("./engine_io");
var irc = require("./irc");

module.exports = {
  CONN_STATES: base.CONN_STATES,
  PROTO_VERSION: base.PROTO_VERSION,
  ProxyConnection: proxy.ProxyConnection,
  EIOProxyConnection: engine_io.EIOProxyConnection,
  IRCProxyConnection: irc.IRCProxyConnection
};