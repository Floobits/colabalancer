"use strict";

const events = require("events");
const net = require("net");
const tls = require("tls");
const util = require("util");

const log = require("floorine");
let request = require("request");

const settings = require("../settings");

const CONN_STATES = {
  auth_wait: 0,
  control_wait: 1,
  colab_wait: 2,
  active: 3,
  client_disconnected: 4,
  colab_disconnected: 5
};

const PROTO_VERSION = "0.11";

request = request.defaults(settings.request_defaults);


const BaseProxyConnection = function (id, conn, server, opts) {
  const self = this;

  events.EventEmitter.call(self);

  opts = opts || {};
  log.debug("%s opts %s", self.toString(), JSON.stringify(opts));

  let auth_timeout = opts.auth_timeout || settings.auth_timeout;

  self.id = id;
  self.state = CONN_STATES.auth_wait;
  self.conn = conn;
  self.colab_conn = null;
  self.remote_address = self._remote_address(conn);
  self.is_ssl = !!opts.is_ssl;
  self.opts = opts;
  self.auth_timeout_id = setTimeout(self.disconnect.bind(self, "Auth timeout reached."), auth_timeout);
  self.buf = "";
  self.colab_buf = "";
  self.on_data_handler = self.on_data.bind(self);
};

util.inherits(BaseProxyConnection, events.EventEmitter);

BaseProxyConnection.prototype.toString = function () {
  const self = this;
  return util.format("%s %s %s", self.protocol, self.id, self.remote_address);
};

BaseProxyConnection.prototype.connect_to_colab = function (url, req, cb) {
  const self = this;

  self.state = CONN_STATES.control_wait;

  log.debug("Hitting URL", url);

  const options = {
    json: true
  };
  let proto = net;
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
    }, function (connect_err) {
      if (connect_err) {
        return cb(util.format("Error getting colab IP from control server: %s", connect_err));
      }

      self.state = CONN_STATES.active;
      req._forward_options = {
        protocol: self.protocol,
        remote_address: self.remote_address
      };
      try {
        req._forward_options.ssl = self.is_ssl;
      } catch (e) {
        return cb(util.format("Error reading SSL state from client conn: %s", e));
      }
      self.colab_conn.write(JSON.stringify(req) + "\n");

      return cb();
    });

    self.colab_conn.on("error", function (conn_err) {
      self.disconnect(util.format("Colab connection error: %s", conn_err));
    });

    self.colab_conn.on("end", function () {
      self.disconnect("Colab connection ended.");
    });

    self.state = CONN_STATES.colab_wait;
  });
};

BaseProxyConnection.prototype.cancel_auth_timeout = function () {
  const self = this;
  clearTimeout(self.auth_timeout_id);
  self.auth_timeout_id = null;
};

BaseProxyConnection.prototype._remote_address = function (conn) {
  return conn.remoteAddress;
};

BaseProxyConnection.prototype.on_auth = function (req, cb) {
  const self = this;

  let url;
  if (req.path) {
    url = util.format("%s/p/%s", settings.control_servers[0], req.path);
  } else if (req.room_owner && req.room) {
    req.path = util.format("%s/%s", req.room_owner, req.room);
    url = util.format("%s/r/%s/%s", settings.control_servers[0], req.room_owner, req.room);
  } else {
    return cb("Invalid authentication message.");
  }

  self.connect_to_colab(url, req, function (err, result) {
    if (err && result && result.statusCode === 404) {
      return cb(err, util.format("Workspace %s doesn't exist.", req.path));
    }
    return cb(err);
  });
};

BaseProxyConnection.prototype.on_create_user = function (req, cb) {
  const self = this;
  const url = util.format("%s/u/%s", settings.control_servers[0], req.username);
  self.connect_to_colab(url, req, cb);
};

BaseProxyConnection.prototype.on_request_credentials = function (data, cb) {
  const self = this;
  const url = util.format("%s/t/%s", settings.control_servers[0], data.token);
  self.connect_to_colab(url, data, cb);
};

BaseProxyConnection.prototype.on_supply_credentials = function (data, cb) {
  const self = this;
  const url = util.format("%s/t/%s", settings.control_servers[0], data.token);
  self.connect_to_colab(url, data, cb);
};

BaseProxyConnection.prototype.on_colab_data = function (d) {
  const self = this;

  log.debug("d: |" + d + "|");

  self.colab_buf += d;

  // TODO: Don't need to do this for self.colab_buf, just d
  let newline_index = self.colab_buf.indexOf("\n");
  while (newline_index !== -1) {
    let msg = self.colab_buf.slice(0, newline_index);
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      self.disconnect(util.format("handle_msg couldn't parse json: %s error: %s", msg, e));
      return;
    }
    self.colab_buf = self.colab_buf.slice(newline_index + 1);
    self.handle_colab_msg(msg);
    newline_index = self.colab_buf.indexOf("\n");
  }
};

module.exports = {
  BaseProxyConnection,
  CONN_STATES,
  PROTO_VERSION,
};
