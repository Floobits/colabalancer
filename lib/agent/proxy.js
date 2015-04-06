"use strict";

var util = require("util");

var log = require("floorine");

var base = require("./base");
var settings = require("../settings");

var BaseProxyConnection = base.BaseProxyConnection;
var CONN_STATES = base.CONN_STATES;


/*jslint unparam: true*/
var ProxyConnection = function (id, conn) {
  var self = this;

  BaseProxyConnection.apply(self, arguments);

  self.protocol = "floobits";

  conn.on("data", self.on_data_handler);
  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect();
  });
};
/*jslint unparam: false*/

util.inherits(ProxyConnection, BaseProxyConnection);

ProxyConnection.prototype.on_data = function (d) {
  var self = this,
    msg,
    newline_index;

  log.debug("d: |" + d + "|");

  if (self.state !== CONN_STATES.auth_wait) {
    return self.disconnect();
  }

  if (self.buf.length + d.length > settings.max_buf_len) {
    return self.disconnect("Sorry. Your client sent a message that is too big.");
  }

  self.buf += d;

  newline_index = d.indexOf("\n");
  if (newline_index === -1) {
    return null;
  }

  if (newline_index !== d.length - 1) {
    return self.disconnect();
  }

  try {
    msg = JSON.parse(self.buf);
  } catch (e) {
    log.error("couldn't parse json:", msg, "error:", e);
    return self.disconnect();
  }

  self.cancel_auth_timeout();

  switch (msg.name) {
  case "request_credentials":
    return self.on_request_credentials(msg, self.forward_data.bind(self));
  case "supply_credentials":
    return self.on_supply_credentials(msg, self.forward_data.bind(self));
  case "create_user":
    return self.on_create_user(msg, self.forward_data.bind(self));
  default:
    return self.on_auth(msg, self.forward_data.bind(self));
  }
};

ProxyConnection.prototype.forward_data = function (err, reason) {
  var self = this;

  if (err) {
    return self.disconnect(err, reason);
  }

  self.conn.pipe(self.colab_conn);
  self.colab_conn.pipe(self.conn);

  self.conn.removeListener("data", self.on_data_handler);
  self.on_data_handler = null;
};

ProxyConnection.prototype.disconnect = function (err, reason) {
  var self = this;

  log.log("Disconnecting %s: %s", self.id, err);
  self.cancel_auth_timeout();

  if (reason) {
    self.conn.write(JSON.stringify({
      name: "disconnect",
      reason: reason
    }));
    self.conn.write("\n");
  }

  if (self.colab_conn) {
    try {
      self.colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

  try {
    self.conn.destroy();
  } catch (e2) {
    log.error("Error disconnecting %s: %s", self.id, e2);
  }
  self.emit("on_conn_end", self);
};

module.exports = {
  ProxyConnection: ProxyConnection,
};
