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

  self.id = id;
  self.state = conn_states.auth_wait;
  self.colab_conn = null;
  self.conn = conn;
  self.remote_address = self._remote_address();
  self.auth_timeout_id = setTimeout(self.disconnect.bind(self), settings.auth_timeout);
  self.buf = "";
};

util.inherits(BaseProxyConnection, events.EventEmitter);

BaseProxyConnection.prototype.on_auth = function (req, cb) {
  var self = this,
    options = {
      json: true
    },
    url = util.format("%s/r/%s/%s", settings.control_servers[0], req.owner, req.name);

  self.state = conn_states.control_wait;

  request.get(url, options, function (err, result, body) {
    if (err) {
      return cb(util.format("Error getting colab IP from control server: %s", err));
    }

    if (result.statusCode >= 400) {
      return cb(util.format("Bad status code getting colab IP from control server: %s", err));
    }

    self.colab_conn = net.connect({
      host: body.ip,
      port: 3149
    }, function (err, result) {
      if (err) {
        return cb(util.format("Error getting colab IP from control server: %s", err));
      }

      self.state = conn_states.active;
      req._ssl = true; //TODO
      req._remote_address = self.remote_address;
      req._protocol = self.protocol;
      self.colab_conn.write(JSON.stringify(req) + "\n");

      return cb();
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

BaseProxyConnection.prototype.cancel_auth_timeout = function () {
  var self = this;

  clearTimeout(self.auth_timeout_id);
  self.auth_timeout_id = null;
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

  self.cancel_auth_timeout();

  switch (msg.name) {
  case "request_credentials":
    return self.request_credentials(msg);
  case "create_user":
    return self.create_user(msg);
  default:
    return self.on_auth(msg, function (err, result) {
      if (err) {
        return self.disconnect(err);
      }

      self.conn.pipe(self.colab_conn);
      self.colab_conn.pipe(self.conn);

      self.conn.removeListener("data", self.on_data_handler);
      self.on_data_handler = null;
    });
  }
};

ProxyConnection.prototype._remote_address = function () {
  var self = this;
  return self.conn.remoteAddress;
};

ProxyConnection.prototype.disconnect = function (err) {
  var self = this;

  log.log("Disconnecting", self.id, ":", err);
  self.cancel_auth_timeout();
  try {
    self.conn.destroy();
  } catch (e) {
    log.error("Error disconnecting", self.id, ":", e);
  }
  self.emit("on_conn_end", self);
};


var SIOProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "socketio";

  conn.on("supply_credentials", function (data) {
    self.conn.removeAllListeners("auth");
    //TODO
    self.supply_credentials(data);
  });

  conn.on("auth", function (auth_data) {
    self.conn.removeAllListeners("supply_credentials");
    self.on_auth(auth_data, function (err) {
      if (err) {
        return self.disconnect(err);
      }
      self.cancel_auth_timeout();
      self.conn.on("_data", function (req) {
        log.debug("writing", JSON.stringify(req), "to colab");
        self.colab_conn.write(JSON.stringify(req));
        self.colab_conn.write("\n");
      });
      self.colab_conn.on("data", self.on_colab_data.bind(self));
    });
  });
  conn.on("disconnect", function () {
    self.emit("on_conn_end", self);
  });
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

  log.log("Disconnecting", self.id, ":", err);
  self.cancel_auth_timeout();
  self.emit("on_conn_end", self);
};

SIOProxyConnection.prototype.on_colab_data = function (d) {
  var self = this,
    auth_data,
    handle_msg,
    msg,
    newline_index;

  handle_msg = function (msg) {
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      log.error("couldn't parse json:", msg, "error:", e);
      return self.disconnect();
    }

    self.conn.emit(msg.name, msg);
  };

  log.debug("d: |" + d + "|");

  self.buf += d;

  // TODO: Don't need to do this for self.buf, just d
  newline_index = self.buf.indexOf("\n");
  while (newline_index !== -1) {
    msg = self.buf.slice(0, newline_index);
    self.buf = self.buf.slice(newline_index + 1);
    handle_msg(msg);
    newline_index = self.buf.indexOf("\n");
  }
};


module.exports = {
  conn_states: conn_states,
  ProxyConnection: ProxyConnection,
  SIOProxyConnection: SIOProxyConnection
};
