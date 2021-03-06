"use strict";

const util = require("util");

const log = require("floorine");
const _ = require("lodash");

const base = require("./base");

const BaseProxyConnection = base.BaseProxyConnection;
const CONN_STATES = base.CONN_STATES;


const EIOProxyConnection = function (id, conn) {
  const self = this;

  BaseProxyConnection.apply(self, arguments);
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
  const self = this;

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
  const self = this;

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

EIOProxyConnection.prototype._remote_address = function (conn) {
  try {
    const req = conn.request;
    let forwarded_for = req.headers["x-forwarded-for"];
    if (forwarded_for && _.includes(["127.0.0.1", "::ffff:127.0.0.1", "::1"], req.connection.remoteAddress)) {
      log.log("Load balancer forwarded for %s", forwarded_for);
      // XXXX: Horrible hack to make IP address comparisons successful.
      if (forwarded_for.match(/^\d+\.\d+\.\d+\.\d+$/) !== null) {
        forwarded_for = "::ffff:" + forwarded_for;
      }
      return forwarded_for;
    }
    return req.connection.remoteAddress;
  } catch (e) {
    log.error(e);
  }
  return NaN;
};

EIOProxyConnection.prototype.forward_data = function (err) {
  const self = this;

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

EIOProxyConnection.prototype.disconnect = function (err, reason) {
  const self = this;

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
    const colab_conn = self.colab_conn;
    self.colab_conn = null;
    try {
      colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

  if (self.conn) {
    const conn = self.conn;
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
  const self = this;
  self.write(msg);
};

module.exports = {
  EIOProxyConnection,
};
