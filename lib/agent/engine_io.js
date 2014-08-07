/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var util = require("util");

var log = require("floorine");
var _ = require("lodash");

var base = require("./base");
var settings = require("../settings");

var BaseProxyConnection = base.BaseProxyConnection;
var CONN_STATES = base.CONN_STATES;


var EIOProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  // TODO: change this to engineio in colab
  self.protocol = "socketio";

  conn.on("message", self.on_data_handler);

  conn.once("close", function () {
    self.disconnect("engine.io client connection ended.");
  });
  conn.once("error", function () {
    self.disconnect("engine.io client connection error.");
  });
};

util.inherits(EIOProxyConnection, BaseProxyConnection);

EIOProxyConnection.prototype.on_data = function (msg) {
  var self = this;

  log.debug("d: |" + msg + "|");

  if (self.state !== CONN_STATES.auth_wait) {
    log.error("Client %s sent msg and conn state was %s", self.id, self.state);
    return self.disconnect();
  }

  try {
    msg = JSON.parse(msg);
  } catch (e) {
    log.error("couldn't parse json:", msg, "error:", e);
    return self.disconnect("Couldn't parse JSON.");
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

EIOProxyConnection.prototype.write = function (name, data) {
  var self = this;

  if (_.isUndefined(data)) {
    data = name;
  } else {
    data.name = name;
  }

  if (!self.conn) {
    log.error("Can't write: no self.conn.");
    return;
  }
  self.conn.send(JSON.stringify(data));
};

EIOProxyConnection.prototype.is_ssl = function () {
  var self = this,
    req = self.conn.request;

  // Trust localhost as if it were secure. Apache only allows websockets over SSL, so this is OK.
  if (req.connection.remoteAddress === "127.0.0.1") {
    if (req.headers["x-forwarded-for"]) {
      log.log("Load balancer SSL");
      return true;
    }
    log.warn("Source IP is %s but no x-forwarded-for header!", req.connection.remoteAddress);
  }

  return BaseProxyConnection.prototype.is_ssl.apply(self, _.toArray(arguments));
};

EIOProxyConnection.prototype.forward_data = function (err) {
  var self = this;

  if (err) {
    return self.disconnect(err);
  }

  if (!self.conn) {
    return self.disconnect("Client connection lost.");
  }

  self.conn.on("message", function (req) {
    self.colab_conn.write(req);
    self.colab_conn.write("\n");
  });
  self.conn.removeListener("message", self.on_data_handler);
  self.on_data_handler = null;

  self.colab_conn.on("data", self.on_colab_data.bind(self));
};

EIOProxyConnection.prototype._remote_address = function () {
  var self = this,
    req = self.conn.request;

  try {
    if (req.connection.remoteAddress === "127.0.0.1" && req.headers["x-forwarded-for"]) {
      return req.headers["x-forwarded-for"];
    }
    return req.connection.remoteAddress;
  } catch (e) {
    log.error(e);
  }
  return NaN;
};

EIOProxyConnection.prototype.disconnect = function (err, reason) {
  var self = this,
    colab_conn = self.colab_conn,
    conn = self.conn;

  if (self.state === CONN_STATES.colab_disconnected) {
    return;
  }

  log.log("Disconnecting %s: Err %s reason %s", self.id, err, reason);
  self.cancel_auth_timeout();
  if (reason) {
    self.write("disconnect", {
      reason: reason
    });
  }

  if (self.colab_conn) {
    self.colab_conn = null;
    try {
      colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

  if (self.conn) {
    self.conn = null;
    try {
      conn.close();
    } catch (e2) {
      log.error("Error disconnecting client:", e2);
    }
  }

  self.state = CONN_STATES.colab_disconnected;
  self.emit("on_conn_end", self);
};

EIOProxyConnection.prototype.handle_colab_msg = function (msg) {
  var self = this;
  self.write(msg);
};

module.exports = {
  EIOProxyConnection: EIOProxyConnection,
};