var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var tls = require("tls");
var util = require("util");

var async = require("async");
var log = require("floorine");
var socket_io = require("socket.io");
var _ = require("lodash");

var agent = require("./agent");
var settings = require("./settings");


var RESERVED_EVENTS = ["connect", "message", "disconnect", "reconnect", "ping", "join", "leave"];


var ColaBalancerServer = function () {
  var self = this,
    tls_options;

  self.conn_number = 0;
  self.agents = {};
  self.server = net.createServer(self.on_conn.bind(self));
  self.ca = undefined;

  /*jslint stupid: true */
  if (settings.json_port_ssl || settings.socket_io_port_ssl) {
    self.cert = fs.readFileSync(settings.ssl_cert);
    self.key = fs.readFileSync(settings.ssl_key);
    if (settings.ssl_ca) {
      self.ca = [];
      _.each(settings.ssl_ca, function (filename) {
        self.ca.push(fs.readFileSync(filename));
      });
    }
    tls_options = {
      ca: self.ca,
      cert: self.cert,
      key: self.key,
      ciphers: "ECDHE-RSA-AES256-SHA384:AES256-SHA256:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
      honorCipherOrder: true
    };
  }
  /*jslint stupid: false */

  if (settings.json_port_ssl) {
    log.log("json ssl enabled on port", settings.json_port_ssl);
    self.server_ssl = tls.createServer(tls_options, self.on_conn.bind(self));
  }

  if (settings.socket_io_port_ssl) {
    log.log("socket.io ssl enabled on port", settings.socket_io_port_ssl);
    self.https_server = https.createServer(tls_options);
  }

  if (settings.metrics_port) {
    log.log("metrics enabled on port", settings.metrics_port);
    self.metrics_server = http.createServer(self.on_metrics.bind(self));
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

  self.io = socket_io.listen(settings.socket_io_port);

  self.io.configure(function () {
    self.io.enable("browser client minification");
    self.io.enable("browser client etag");
    self.io.enable("browser client gzip");
    self.io.enable("log");
    self.io.set("transports", settings.socket_io_transports);
    self.io.set("log level", 2);
  });
  self.io.sockets.on("connection", self.on_sio_conn.bind(self));
  log.log("Socket.io protocol listening on port", settings.socket_io_port);

  if (self.https_server) {
    self.io_ssl = require("socket.io").listen(self.https_server);
    self.https_server.listen(settings.socket_io_port_ssl);

    log.debug("configuring sio ssl");
    self.io_ssl.configure(function () {
      self.io_ssl.enable("browser client minification");
      self.io_ssl.enable("browser client etag");
      self.io_ssl.enable("browser client gzip");
      self.io_ssl.enable("log");
      self.io_ssl.set("transports", settings.socket_io_transports);
      self.io_ssl.set("log level", 2);
    });
    self.io_ssl.sockets.on("connection", self.on_sio_conn.bind(self));
    log.log("Socket.io SSL protocol listening on port", settings.socket_io_port_ssl);
  } else {
    self.io_ssl = {server: null};
  }
  if (self.metrics_server) {
    self.metrics_server.listen(settings.metrics_port, function (err, res) {
      if (err) {
        log.error(err);
      }
    });
  }
};

ColaBalancerServer.prototype.on_metrics = function (req, res) {
  var self = this,
    metrics = {},
    status = "ok",
    message = "harro",
    response = {},
    type,
    reply;

  reply = function () {
    res.writeHead(200);
    var response = util.format("status %s %s\n", status, message);
    _.each(metrics, function (v, k) {
      response += util.format("metric %s int %s\n", k, v);
    });
    res.end(response);
  };

  type = req.url.split("/")[1];
  if (type === undefined || (_.indexOf(["version", "platform", "client", "control_stats"], type) < 0)) {
    log.warn("Tried to fetch: " + type);
    status = "error";
    message = "404";
    return reply();
  }

  if (type === "control_stats") {
    response.workspaces = _.map(self.workspaces, function (workspace) {
      return {
        id: workspace.id,
        name: workspace.name,
        owner: workspace.owner
      };
    });
    response.memory = process.memoryUsage();
    res.end(JSON.stringify(response));
  }

  _.each(self.agents, function (agent) {
    var metric = (agent[type] && agent[type].toString()) || "undefined";
    metric = metric.replace(/\s/g, "");

    if (!metrics[metric]) {
      metrics[metric] = 1;
    } else {
      metrics[metric] += 1;
    }
  });

  return reply();
};

ColaBalancerServer.prototype.on_conn = function (conn) {
  var self = this,
    agent_conn,
    number;

  number = ++self.conn_number;
  conn.setNoDelay(true); // Disable Nagle algorithm
  conn.setEncoding("utf8");
  if (settings.conn_keepalive) {
    conn.setKeepAlive(true, settings.conn_keepalive);
  }
  if (settings.conn_timeout) {
    conn.setTimeout(settings.conn_timeout, function () {
      conn.end();
      conn.destroy();
    });
  }

  agent_conn = new agent.ProxyConnection(number, conn, self);

  self.agents[number] = agent_conn;
  log.debug("client", number, "connected from", conn.remoteAddress, ":", conn.remotePort);
  agent_conn.once("on_conn_end", self.on_conn_end.bind(self));
};

ColaBalancerServer.prototype.on_conn_end = function (agent_conn) {
  var self = this;

  delete self.agents[agent_conn.id];
  log.debug("client", agent_conn.id, "disconnected");
};

ColaBalancerServer.prototype.on_sio_conn = function (socket) {
  var self = this,
    agent_conn,
    emit = socket.$emit,
    number = ++self.conn_number;

  /* Monkey-patch Socket.io to support on_data */
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

  agent_conn = new agent.SIOProxyConnection(number, socket, self);
  self.agents[number] = agent_conn;
  log.debug("socket io client", number, "connected from", socket.handshake.address.address, ":", socket.handshake.address.port);
  agent_conn.once("on_conn_end", self.on_conn_end.bind(self));
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
    process.exit(0);
  }

  process.on("SIGTERM", function () {shut_down("SIGTERM"); });
  process.on("SIGINT", function () {shut_down("SIGINT"); });

  process.on("SIGHUP", function (sig) {
    //TODO: reload config file and don't actually restart?
    // or just stop listening?
  });

  server.listen();
};
