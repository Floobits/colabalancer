/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var events = require("events");
var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var tls = require("tls");
var util = require("util");

var async = require("async");
var log = require("floorine");
var request = require("request");
var _ = require("lodash");

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
  self.auth_timeout_id = setTimeout(self.disconnect.bind(self, "Auth timeout reached."), settings.auth_timeout);
  self.buf = "";
  self.server = server;
  self.on_data_handler = self.on_data.bind(self);
};

util.inherits(BaseProxyConnection, events.EventEmitter);

BaseProxyConnection.prototype.connect_to_colab = function (url, req, cb) {
  var self = this,
    options = {
      json: true
    },
    proto = net;

  self.state = CONN_STATES.control_wait;

  log.debug("Hitting URL", url);

  request.get(url, options, function (err, result, body) {
    if (err) {
      return cb(util.format("Error getting colab IP from control server: %s", err));
    }

    if (result.statusCode >= 400) {
      return cb(util.format("Bad status code getting colab IP from control server: %s", err || result.statusCode), result);
    }

    if (body.ssl) {
      proto = tls;
    }

    self.colab_conn = proto.connect({
      host: body.ip,
      port: body.port,
      rejectUnauthorized: false
    }, function (err) {
      if (err) {
        return cb(util.format("Error getting colab IP from control server: %s", err));
      }

      self.state = CONN_STATES.active;
      req._forward_options = {
        protocol: self.protocol,
        remote_address: self.remote_address
      };
      try {
        req._forward_options.ssl = self.is_ssl();
      } catch (e) {
        return cb(util.format("Error reading SSL state from client conn: %s", e));
      }
      self.colab_conn.write(JSON.stringify(req) + "\n");

      return cb();
    });

    self.colab_conn.on("error", function (err) {
      self.disconnect(util.format("Colab connection error: %s", err));
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

BaseProxyConnection.prototype._remote_address = function () {
  var self = this;
  return self.conn.remoteAddress;
};

BaseProxyConnection.prototype.is_ssl = function () {
  var self = this;

  if (self.conn) {
    // TODO: one of these first two can be removed, since it was for socket.io
    if (self.conn.manager && _.contains([self.server.server_ssl, self.server.io_ssl.server], self.conn.manager.server)) {
      return true;
    }
    if (self.conn.socket && _.contains([self.server.server_ssl, self.server.io_ssl.server], self.conn.socket.server)) {
      return true;
    }
    // Websocket
    if (self.conn.server && _.contains([self.server.server_ssl, self.server.io_ssl.server], self.conn.server)) {
      return true;
    }
  }
  return false;
};

BaseProxyConnection.prototype.on_auth = function (req, cb) {
  var self = this,
    url;

  if (req.path) {
    url = util.format("%s/p/%s", settings.control_servers[0], req.path);
  } else if (req.room_owner && req.room) {
    url = util.format("%s/r/%s/%s", settings.control_servers[0], req.room_owner, req.room);
  } else {
    return cb("Invalid authentication message.");
  }

  self.connect_to_colab(url, req, function (err, result) {
    if (err && result && result.statusCode === 404) {
      return cb(err, util.format("Workspace %s/%s doesn't exist.", req.room_owner, req.room));
    }
    return cb(err);
  });
};

BaseProxyConnection.prototype.on_create_user = function (req, cb) {
  var self = this,
    url = util.format("%s/u/%s", settings.control_servers[0], req.username);

  self.connect_to_colab(url, req, cb);
};

BaseProxyConnection.prototype.on_request_credentials = function (data, cb) {
  var self = this,
    url = util.format("%s/t/%s", settings.control_servers[0], data.token);

  self.connect_to_colab(url, data, cb);
};

BaseProxyConnection.prototype.on_supply_credentials = function (data, cb) {
  var self = this,
    url = util.format("%s/t/%s", settings.control_servers[0], data.token);

  self.connect_to_colab(url, data, cb);
};


var ProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);

  self.protocol = "floobits";

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

  if (self.buf.length + d.length > settings.max_buf_len) {
    return self.disconnect("Sorry. Your client sent a message that is too big.");
  }

  self.buf += d;

  newline_index = d.indexOf("\n");
  if (newline_index === -1) {
    return;
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
    return self.on_request_credentials(msg, self.pipe_data.bind(self));
  case "supply_credentials":
    return self.on_supply_credentials(msg, self.pipe_data.bind(self));
  case "create_user":
    return self.on_create_user(msg, self.pipe_data.bind(self));
  default:
    return self.on_auth(msg, self.pipe_data.bind(self));
  }
};

ProxyConnection.prototype.pipe_data = function (err, reason) {
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
    return self.on_request_credentials(msg, self.pipe_data.bind(self));
  case "supply_credentials":
    return self.on_supply_credentials(msg, self.pipe_data.bind(self));
  case "create_user":
    return self.on_create_user(msg, self.pipe_data.bind(self));
  default:
    return self.on_auth(msg, self.pipe_data.bind(self));
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

EIOProxyConnection.prototype.pipe_data = function (err) {
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

EIOProxyConnection.prototype.on_colab_data = function (d) {
  var self = this,
    handle_msg,
    msg,
    newline_index;

  handle_msg = function (msg) {
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      return self.disconnect("handle_msg couldn't parse json:", msg, "error:", e);
    }

    self.write(msg);
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


var IRCProxyConnection = function (id, conn, server) {
  var self = this;

  BaseProxyConnection.call(self, id, conn, server);
  self.protocol = "irc";

  self.username = null;
  self.api_secret = null;
  self.path = null;

  conn.on("data", self.on_data_handler);
  conn.on("error", self.disconnect.bind(self));
  conn.on("end", function () {
    self.disconnect("IRC client connection ended.");
  });
};

util.inherits(IRCProxyConnection, BaseProxyConnection);

IRCProxyConnection.prototype.parse_irc = function (line) {
  var self = this,
    args,
    command,
    prefix;

  log.debug("line: '%s'", line);
  args = line.split(" ");

  if (line[0] === ":") {
    prefix = line.split(" ")[0].slice(1);
    log.debug("prefix: %s", prefix);
    if (prefix !== self.username) {
      self.disconnect("Your IRC client sent an invalid prefix.");
    }
    command = args[1];
    args = args.slice(2);
  } else {
    command = args[0];
    args = args.slice(1);
  }

  return {
    args: args,
    command: command.toLowerCase(),
    prefix: prefix
  };
};

IRCProxyConnection.prototype.on_data = function (d) {
  var self = this,
    f,
    line,
    newline_index,
    msg;

  log.debug("d: |" + d + "|");

  if (self.buf.length + d.length > settings.max_buf_len) {
    self.disconnect("Sorry. Your client sent a message that is too big.");
    return;
  }

  self.buf += d;

  newline_index = self.buf.indexOf("\r\n");
  while (newline_index !== -1) {
    line = self.buf.slice(0, newline_index);
    self.buf = self.buf.slice(newline_index + 2);
    msg = self.parse_irc(line);
    log.debug("parsed line: %s", JSON.stringify(msg));
    newline_index = self.buf.indexOf("\r\n");

    f = self["_on_" + msg.command];
    if (f) {
      f.call(this, msg);
    } else {
      log.error("No IRCProxyConnection handler for event %s.", msg.command);
    }
  }
};

IRCProxyConnection.prototype.check_auth = function () {
  var self = this;

  if (!self.username || !self.api_secret || !self.path) {
    log.debug("%s %s %s", self.username, self.api_secret, self.path);
    return;
  }

  if (!self.auth_timeout_id) {
    log.warn("IRC check_auth: Auth timeout already cancelled. Not checking auth again.");
    return;
  }

  self.cancel_auth_timeout();

  self.on_auth({
    username: self.username,
    api_secret: self.api_secret,
    path: self.path
  }, self.pipe_data.bind(self));
};

IRCProxyConnection.prototype._on_nick = function (msg) {
  var self = this;

  self.username = msg.args[0];
  self.conn.write(util.format(":%s!%s@%s NICK :%s", self.username, self.username, self._remote_address(), self.username));
  self.check_auth();
};

IRCProxyConnection.prototype._on_user = function (msg) {
  var self = this;

  self.username = msg.args[0];
  self.check_auth();
};

IRCProxyConnection.prototype._on_pass = function (msg) {
  var self = this;

  self.api_secret = msg.args[0];
  self.check_auth();
};

IRCProxyConnection.prototype._on_join = function (msg) {
  var self = this;

  self.path = msg.args[0].slice(1);
  self.check_auth();
};

IRCProxyConnection.prototype.disconnect = function (err, reason) {
  var self = this;

  log.log("Disconnecting %s: %s", self.id, err);
  self.cancel_auth_timeout();

  if (reason) {
    self.conn.write(util.format("DISCONNECT REASON %s\r\n", reason));
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
  CONN_STATES: CONN_STATES,
  ProxyConnection: ProxyConnection,
  EIOProxyConnection: EIOProxyConnection,
  IRCProxyConnection: IRCProxyConnection
};
