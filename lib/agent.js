var events = require("events");
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


var conn_states = {
  auth_wait: 0,
  control_wait: 1,
  colab_wait: 2,
  active: 3,
  client_disconnected: 4,
  colab_disconnected: 5
};


var BaseProxyConnection = function (id, conn, server) {
  var self = this;

  self.state = conn_states.auth_wait;
  self.colab_conn = null;
  self.conn = conn;
  self.remote_address = self._remote_address();
};

util.inherits(BaseProxyConnection, events.EventEmitter);

BaseProxyConnection.prototype.on_auth = function (req) {
  var self = this,
    options = {
      json: true
    },
    url = util.format("%s/r/%s/%s", settings.control_servers[0], req.owner, req.name);

  self.state = conn_states.control_wait;

  request.get(url, options, function (err, result, body) {
    if (err) {
      return self.disconnect(util.format("Error getting colab IP from control server: %s", err));
    }

    if (result.statusCode >= 400) {
      return self.disconnect(util.format("Bad status code getting colab IP from control server: %s", err));
    }

    self.colab_conn = tls.connect({
      host: body.ip,
      port: 3448
    }, function (err, result) {
      if (err) {
        return self.disconnect(util.format("Error getting colab IP from control server: %s", err));
      }

      self.state = conn_states.active;
      req._ssl = true;
      req._remote_address = self.remote_address;
      req._protocol = self.protocol;
      self.colab_conn.write(req);

      self.conn.pipe(self.colab_conn);
      self.colab_conn.pipe(self.conn);

      self.conn.removeListener("data", self.on_data_handler);
      self.on_data_handler = null;
    });

    self.colab_conn.on("error", function () {
      self.disconnect();
    });

    self.colab_conn.on("end", function () {
      self.disconnect();
    });

    self.state = conn_states.colab_wait;
  });
};


var ProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);

  self.protocol = "floobits";

  self.on_data_handler = self.on_data.bind(self);
  conn.on("data", self.on_data_handler);
  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect();
  });

  self.buf = "";
};

util.inherits(ProxyConnection, BaseProxyConnection);

ProxyConnection.prototype.on_data = function (d) {
  var self = this,
    msg,
    newline_index;

  log.debug("d: |" + d + "|");

  if (self.state !== conn_states.auth_wait) {
    return self.disconnect();
  }

  newline_index = d.indexOf("\n");
  if (newline_index === -1) {
    return;
  }

  if (newline_index !== d.length - 1) {
    return self.disconnect();
  }

  if (self.buf.length + d.length > settings.max_buf_len) {
    return self.disconnect("Sorry. Your client sent a message that is too big.");
  }

  self.buf += d;

  try {
    msg = JSON.parse(self.buf);
  } catch (e) {
    log.error("couldn't parse json:", msg, "error:", e);
    return self.disconnect();
  }

  clearTimeout(self.auth_timeout_id);

  switch (msg.name) {
  case "request_credentials":
    return self.request_credentials(msg);
  case "create_user":
    return self.create_user(msg);
  default:
    return self.on_auth(msg);
  }
};

ProxyConnection.prototype._remote_address = function () {
  var self = this;
  return self.conn.remoteAddress;
};

ProxyConnection.prototype.disconnect = function (err) {
  var self = this;
  self.emit("on_conn_end", self);
};


var SIOProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "socketio";
};

util.inherits(SIOProxyConnection, BaseProxyConnection);

SIOProxyConnection.prototype._remote_address = function () {
  var self = this;
  try {
    return self.conn.handshake.address.address;
  } catch (e) {
    log.error(e);
  }
  return NaN;
};

SIOProxyConnection.prototype.disconnect = function (err) {
  var self = this;
  self.emit("on_conn_end", self);
};


module.exports = {
  conn_states: conn_states,
  ProxyConnection: ProxyConnection,
  SIOProxyConnection: SIOProxyConnection
};
