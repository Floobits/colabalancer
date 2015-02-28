/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var tls = require("tls");
var util = require("util");

var async = require("async");
var log = require("floorine");
var engine_io = require("engine.io");
var _ = require("lodash");

var agent = require("./agent");
var settings = require("./settings");


var RESERVED_EVENTS = ["connect", "message", "disconnect", "reconnect", "ping", "join", "leave"];


var ColaBalancerServer = function () {
  var self = this,
    tls_options;

  self.conn_number = 0;
  self.agents = {};
  self.server = net.createServer(self.on_conn.bind(self, agent.ProxyConnection));
  self.http_server = http.createServer(self.on_conn.bind(self, agent.EIOProxyConnection));
  self.irc_server = net.createServer(self.on_conn.bind(self, agent.IRCMultiplexer));
  self.ca = undefined;
  self.start_time = new Date().toISOString();

  /*jslint stupid: true */
  if (settings.json_port_ssl || settings.engine_io_port_ssl || settings.irc_port_ssl) {
    self.cert = fs.readFileSync(settings.ssl_cert);
    self.key = fs.readFileSync(settings.ssl_key);
    if (settings.ssl_ca && !_.isEmpty(settings.ssl_ca)) {
      self.ca = [];
      _.each(settings.ssl_ca, function (filename) {
        self.ca.push(fs.readFileSync(filename));
      });
    }
    tls_options = {
      ca: self.ca,
      cert: self.cert,
      key: self.key,
      ciphers: settings.ciphers,
      honorCipherOrder: true
    };
  }
  /*jslint stupid: false */

  if (settings.json_port_ssl) {
    log.log("json ssl enabled on port", settings.json_port_ssl);
    self.server_ssl = tls.createServer(tls_options, function (conn) {
      self.on_conn(agent.ProxyConnection, conn, {
        is_ssl: true
      });
    });
  }

  if (settings.engine_io_port_ssl) {
    log.log("engine.io ssl enabled on port", settings.engine_io_port_ssl);
    self.https_server = https.createServer(tls_options);
  }

  if (settings.irc_port_ssl) {
    log.log("IRC ssl enabled on port", settings.irc_port_ssl);
    self.irc_server_ssl = tls.createServer(tls_options, function (conn) {
      self.on_conn(agent.IRCMultiplexer, conn, {
        is_ssl: true
      });
    });
  }
};

ColaBalancerServer.prototype.listen = function () {
  var self = this;
  self.server.listen(settings.json_port);
  log.log("JSON protocol listening on port", settings.json_port);

  if (self.server_ssl) {
    self.server_ssl.listen(settings.json_port_ssl);
    log.log("JSON SSL protocol listening on port", settings.json_port_ssl);
  } else {
    self.server_ssl = {server: null};
  }

  self.irc_server.listen(settings.irc_port);
  log.log("IRC protocol listening on port", settings.irc_port);

  if (self.irc_server_ssl) {
    self.irc_server_ssl.listen(settings.irc_port_ssl);
    log.log("IRC SSL protocol listening on port", settings.irc_port_ssl);
  } else {
    self.irc_server_ssl = {server: null};
  }

  self.io = engine_io.attach(self.http_server, {
    transports: settings.engine_io_transports
  });
  self.http_server.listen(settings.engine_io_port);
  self.io.on("connection", self.on_sio_conn.bind(self));
  log.log("engine.io protocol listening on port", settings.engine_io_port);

  if (self.https_server) {
    self.io_ssl = engine_io.attach(self.https_server, {
      transports: settings.engine_io_transports
    });
    self.https_server.listen(settings.engine_io_port_ssl);
    self.io_ssl.on("connection", function (conn) {
      self.on_sio_conn(conn, {
        is_ssl: true
      });
    });
    log.log("engine.io SSL protocol listening on port", settings.engine_io_port_ssl);
  } else {
    self.io_ssl = {server: null};
  }
};

ColaBalancerServer.prototype.on_conn = function (AgentConnection, conn, opts) {
  var self = this,
    agent_conn,
    number;

  number = ++self.conn_number;
  if (conn.setNoDelay) {
    conn.setNoDelay(true); // Disable Nagle algorithm
  }
  if (conn.setEncoding) {
    conn.setEncoding("utf8");
  }
  if (settings.conn_keepalive && conn.setKeepAlive) {
    conn.setKeepAlive(true, settings.conn_keepalive);
  }
  agent_conn = new AgentConnection(number, conn, self, opts);

  self.agents[number] = agent_conn;
  log.debug("client %s protcol %s connected from %s:%s", number, agent_conn.protocol, conn.remoteAddress, conn.remotePort);
  agent_conn.once("on_conn_end", self.on_conn_end.bind(self));
};

ColaBalancerServer.prototype.on_conn_end = function (agent_conn) {
  var self = this;

  delete self.agents[agent_conn.id];
  log.debug("client", agent_conn.id, "disconnected");
};

ColaBalancerServer.prototype.on_sio_conn = function (socket, opts) {
  var self = this,
    emit = socket.$emit,
    req = socket.request,
    remote_ip = req.connection.remoteAddress;

  opts = opts || {};

  /* Monkey-patch engine.io to support on_data */
  socket.$emit = function () {
    var args = Array.prototype.slice.call(arguments);
    emit.apply(socket, arguments);
    if (!args[0] || _.contains(RESERVED_EVENTS, args[0])) {
      return;
    }
    if (!_.isObject(args[1])) {
      // Lame process ack heartbeat thingy
      return;
    }
    args[1].name = args[0];
    args[0] = "_data";
    emit.apply(socket, args);
  };

  // Trust localhost as if it were secure. Apache only allows websockets over SSL, so this is OK.
  if (_.contains(["127.0.0.1", "::ffff:127.0.0.1", "::1"], remote_ip)) {
    if (req.headers["x-forwarded-for"]) {
      log.log("Load balancer SSL");
      opts.is_ssl = true;
    } else {
      log.warn("Source IP is %s but no x-forwarded-for header!", remote_ip);
    }
  }

  self.on_conn(agent.EIOProxyConnection, socket, opts);
};

ColaBalancerServer.prototype.stop = function () {
  var self = this;

  log.log("Closing server...");
  self.server.close();
  log.log("Done closing server.");
};


exports.run = function () {
  var server;

  log.set_log_level(settings.log_level);

  server = new ColaBalancerServer();

  function shut_down(sig) {
    log.log("caught signal: ", sig);
    server.stop();
    process.exit(0);
  }

  process.on("SIGTERM", function () {shut_down("SIGTERM"); });
  process.on("SIGINT", function () {shut_down("SIGINT"); });

  process.on("SIGHUP", function (sig) {
    //TODO: reload config file and don't actually restart?
    // or just stop listening?
    log.warn("Got SIGHUP", sig);
  });

  server.listen();
};
