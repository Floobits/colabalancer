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


var CONN_STATES = {
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
  self.state = CONN_STATES.auth_wait;
  self.colab_conn = null;
  self.conn = conn;
  self.remote_address = self._remote_address();
  self.auth_timeout_id = setTimeout(self.disconnect.bind(self), settings.auth_timeout);
  self.buf = "";
  self.server = server;
};

util.inherits(BaseProxyConnection, events.EventEmitter);

BaseProxyConnection.prototype.connect_to_colab = function (url, req, cb) {
  var self = this,
    options = {
      json: true
    };

  self.state = CONN_STATES.control_wait;

  request.get(url, options, function (err, result, body) {
    if (err) {
      return cb(util.format("Error getting colab IP from control server: %s", err));
    }

    if (result.statusCode >= 400) {
      return cb(util.format("Bad status code getting colab IP from control server: %s", err));
    }

    self.colab_conn = net.connect({
      host: body.ip,
      port: body.port
    }, function (err, result) {
      if (err) {
        return cb(util.format("Error getting colab IP from control server: %s", err));
      }

      self.state = CONN_STATES.active;
      req._forward_options = {
        protocol: self.protocol,
        remote_address: self.remote_address,
        ssl: self.is_ssl()
      };
      self.colab_conn.write(JSON.stringify(req) + "\n");

      return cb();
    });

    self.colab_conn.on("error", function () {
      self.disconnect("Colab connection error!");
    });

    self.colab_conn.on("end", function () {
      self.disconnect("Colab connection ended.");
    });

    self.state = CONN_STATES.colab_wait;
  });
};

BaseProxyConnection.prototype.cancel_auth_timeout = function () {
  var self = this;

  clearTimeout(self.auth_timeout_id);
  self.auth_timeout_id = null;
};

BaseProxyConnection.prototype.is_ssl = function () {
  var self = this;

  if (self.conn) {
    if (self.conn.manager && _.contains([self.server.server_ssl, self.server.io_ssl.server], self.conn.manager.server)) {
      return true;
    }
    if (self.conn.socket && _.contains([self.server.server_ssl, self.server.io_ssl.server], self.conn.socket.server)) {
      return true;
    }
  }
  return false;
};

BaseProxyConnection.prototype.on_auth = function (req, cb) {
  var self = this,
    url = util.format("%s/r/%s/%s", settings.control_servers[0], req.owner, req.name);

  self.connect_to_colab(url, req, cb);
};

BaseProxyConnection.prototype.on_request_credentials = function (data, cb) {
  var self = this,
    url = util.format("%s/u/%s", settings.control_servers[0], data.username);

  self.connect_to_colab(url, data, cb);
};

BaseProxyConnection.prototype.on_supply_credentials = function (data, cb) {
  var self = this,
    url = util.format("%s/u/%s", settings.control_servers[0], data.username);

  self.connect_to_colab(url, data, cb);
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

  if (self.state !== CONN_STATES.auth_wait) {
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
    return self.on_request_credentials(msg, self.pipe_data.bind(self));
  case "supply_credentials":
    return self.on_supply_credentials(msg, self.pipe_data.bind(self));
  case "create_user":
    return self.on_create_user(msg, self.pipe_data.bind(self));
  default:
    return self.on_auth(msg, self.pipe_data.bind(self));
  }
};

ProxyConnection.prototype.pipe_data = function (err, result) {
  var self = this;

  if (err) {
    return self.disconnect(err);
  }

  self.conn.pipe(self.colab_conn);
  self.colab_conn.pipe(self.conn);

  self.conn.removeListener("data", self.on_data_handler);
  self.on_data_handler = null;
};

ProxyConnection.prototype._remote_address = function () {
  var self = this;
  return self.conn.remoteAddress;
};

ProxyConnection.prototype.disconnect = function (err) {
  var self = this;

  log.log("Disconnecting", self.id, ":", err);
  self.cancel_auth_timeout();

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
    log.error("Error disconnecting", self.id, ":", e2);
  }
  self.emit("on_conn_end", self);
};


var SIOProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "socketio";

  conn.on("request_credentials", function (data) {
    self.conn.removeAllListeners("auth");
    self.conn.removeAllListeners("supply_credentials");
    self.on_request_credentials(data, self.pipe_data.bind(self));
  });
  conn.on("supply_credentials", function (data) {
    self.conn.removeAllListeners("auth");
    self.conn.removeAllListeners("request_credentials");
    self.on_supply_credentials(data, self.pipe_data.bind(self));
  });
  conn.on("auth", function (auth_data) {
    self.conn.removeAllListeners("request_credentials");
    self.conn.removeAllListeners("supply_credentials");
    self.on_auth(auth_data, self.pipe_data.bind(self));
  });
  conn.on("disconnect", function () {
    self.disconnect("Client socket.io connection ended.");
  });
};

util.inherits(SIOProxyConnection, BaseProxyConnection);

SIOProxyConnection.prototype.pipe_data = function (err, result) {
  var self = this;

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
};

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

  if (self.colab_conn) {
    try {
      self.colab_conn.destroy();
    } catch (e) {
      log.error("Error disconnecting from colab:", e);
    }
  }

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
      return self.disconnect("handle_msg couldn't parse json:", msg, "error:", e);
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
  CONN_STATES: CONN_STATES,
  ProxyConnection: ProxyConnection,
  SIOProxyConnection: SIOProxyConnection
};
